import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { isContextOverflow } from "@earendil-works/pi-ai";
import {
	getAgentRuntimeSettings,
	getFirstValidAgentModelCandidate,
	getValidAgentModelCandidates,
	type AgentConfig,
	type AgentModelCandidate,
	type ModelRegistryLike,
} from "./agents.js";
import {
	findSubagentSessionFileById,
	getSubagentSessionDirForParent,
	getSubagentSessionPath,
	updateManifest,
} from "./session.js";
import {
	createEmptyUsage,
	createUnknownAgentResult,
	type AttemptMetadata,
	type ParentSessionInfo,
	type ResolveModelInfo,
	type SingleResult,
	type TaskRequest,
} from "./types.js";

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

export function buildSingleAgentArgs(
	agentName: string,
	task: string,
	candidate?: AgentModelCandidate,
	session?: { file: string } | { id: string; dir: string },
): string[] {
	const args = ["--mode", "json", "-p", "--agent", agentName];
	if (candidate) {
		const settings = getAgentRuntimeSettings({
			name: agentName,
			description: "",
			hidden: false,
			tools: [],
			model: candidate.id,
			systemPrompt: "",
			source: "package",
			filePath: "",
		});
		if (!settings.modelRef) throw new Error(`model candidate for agent "${agentName}" is empty`);
		args.push("--model", settings.modelRef);
		if (settings.thinkingLevel) args.push("--thinking", settings.thinkingLevel);
	}
	if (session) {
		if ("file" in session) args.push("--session", session.file);
		else args.push("--session", session.id, "--session-dir", session.dir);
	} else args.push("--no-session");
	args.push(`Task: ${task}`);
	return args;
}

type ModelFailureKind = "success" | "context_overflow" | "deterministic" | "transient" | "other";

const MAX_TRANSIENT_ATTEMPTS_PER_CANDIDATE = 3;

function getMessageText(message: Message | undefined): string {
	if (!message || (message.role !== "assistant" && message.role !== "toolResult")) return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function getFailureText(result: SingleResult): string {
	const finalMessageText =
		result.stopReason === "error" && !result.errorMessage
			? getMessageText(result.messages.at(-1))
			: "";
	return [result.stderr, result.errorMessage, finalMessageText].filter(Boolean).join("\n");
}

function summarizeFailure(result: SingleResult): string | undefined {
	const text = getFailureText(result).replace(/\s+/g, " ").trim();
	if (!text) return result.exitCode === 0 ? undefined : `exit ${result.exitCode}`;
	return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function isRetryableFailure(kind: ModelFailureKind): boolean | undefined {
	if (kind === "transient") return true;
	if (kind === "deterministic" || kind === "context_overflow") return false;
	return undefined;
}

function formatAttemptFailure(attempt: AttemptMetadata): string {
	return `${attempt.attemptedModel} attempt ${attempt.attempt}: ${attempt.error ?? `exit ${attempt.exitCode ?? "unknown"}`}`;
}

export function classifyModelChainResult(result: SingleResult): ModelFailureKind {
	const lastAssistant = [...result.messages]
		.reverse()
		.find((message): message is Message & { role: "assistant" } => message.role === "assistant");
	if (lastAssistant && isContextOverflow(lastAssistant, result.usage.contextWindow)) {
		return "context_overflow";
	}

	const text = getFailureText(result).toLowerCase();
	if (result.stopReason === "aborted") return "other";
	if (result.stopReason !== "error" && !result.errorMessage && result.exitCode === 0) {
		return "success";
	}

	if (!text) return "other";
	if (
		/(context window|context length|context size|prompt is too long|request_too_large|input token count exceeds|maximum prompt length|too large for model|exceeded model token limit)/i.test(
			text,
		)
	) {
		return "context_overflow";
	}
	if (
		/(invalid api key|api key.*invalid|missing api key|no api key|unauthorized api|api.*unauthorized|model.*not found|not found.*model|model.*unavailable|model.*gated|access.*model|insufficient_quota|insufficient funds|billing.*provider|provider.*billing|credits exhausted|funds exhausted)/i.test(
			text,
		)
	) {
		return "deterministic";
	}
	if (
		/(request timed out|api.*timeout|provider.*timeout|econnreset|enotfound|rate limit|429.*(provider|api|model)|provider.*429|api.*429|provider.*5\d\d|api.*5\d\d|5\d\d.*(provider|api|model)|overloaded|temporarily unavailable|provider.*service unavailable|api.*service unavailable|service unavailable.*(provider|api|model))/i.test(
			text,
		)
	) {
		return "transient";
	}
	return "other";
}

export async function runSingleAgent(
	agents: AgentConfig[],
	request: TaskRequest,
	signal: AbortSignal | undefined,
	onUpdate: ((result: SingleResult) => void) | undefined,
	resolveModelInfo?: ResolveModelInfo,
	parentSessionInfo?: ParentSessionInfo,
	modelRegistry?: ModelRegistryLike,
): Promise<SingleResult> {
	const agent = agents.find((candidate) => candidate.name === request.agent);
	if (!agent) return createUnknownAgentResult(request.agent, request.task, agents);

	const runCwd = request.cwd;
	let subagentSession:
		| {
				dir: string;
				sessionFile: string;
				sessionId?: string;
				cliSession: { file: string } | { id: string; dir: string };
		  }
		| undefined;
	if (request.resume !== undefined && request.resume.trim() === "") {
		return {
			agent: request.agent,
			agentSource: agent.source,
			task: request.task,
			resumed: true,
			exitCode: 1,
			messages: [],
			stderr:
				"Invalid empty subagent resume ID. Use the exact value from a previous <subagent-resume-id> tag, or omit resume for a fresh session.",
			usage: createEmptyUsage(),
		};
	}
	if (request.resume && !parentSessionInfo) {
		return {
			agent: request.agent,
			agentSource: agent.source,
			task: request.task,
			resumed: true,
			exitCode: 1,
			messages: [],
			stderr: "Cannot resume a subagent session when the parent session is not persisted.",
			usage: createEmptyUsage(),
		};
	}
	if (parentSessionInfo) {
		if (request.resume) {
			const dir = getSubagentSessionDirForParent(parentSessionInfo.sessionId, runCwd);
			const sessionFile = await findSubagentSessionFileById(dir, request.resume);
			if (!sessionFile) {
				return {
					agent: request.agent,
					agentSource: agent.source,
					task: request.task,
					resumed: true,
					exitCode: 1,
					messages: [],
					stderr: `Unknown subagent resume ID "${request.resume}" for this parent session and cwd.`,
					usage: createEmptyUsage(),
				};
			}
			subagentSession = {
				dir,
				sessionFile,
				sessionId: request.resume,
				cliSession: { id: request.resume, dir },
			};
		} else {
			const nextSession = getSubagentSessionPath(
				parentSessionInfo.sessionFile,
				parentSessionInfo.sessionId,
				runCwd,
			);
			subagentSession = {
				dir: nextSession.dir,
				sessionFile: nextSession.sessionFile,
				cliSession: { file: nextSession.sessionFile },
			};
		}
	}
	const validModelCandidates = modelRegistry
		? getValidAgentModelCandidates(agent, modelRegistry)
		: agent.modelCandidates;
	if (agent.modelCandidates && modelRegistry && validModelCandidates?.length === 0) {
		return {
			agent: request.agent,
			agentSource: agent.source,
			task: request.task,
			resumed: Boolean(request.resume),
			exitCode: 1,
			messages: [],
			stderr: `Subagent ${agent.name} failed: no valid model candidates available.`,
			usage: createEmptyUsage(),
		};
	}
	const shouldTrackAttempts = Boolean(validModelCandidates?.length);
	const candidates = validModelCandidates?.length ? validModelCandidates : [undefined];
	const startTime = Date.now();
	const attempts: AttemptMetadata[] = [];
	let wasAborted = false;
	let terminalContextOverflow = false;
	let currentResult: SingleResult | undefined;
	let finalSubagentSession = subagentSession;

	for (const candidate of candidates) {
		const maxAttempts = candidate ? MAX_TRANSIENT_ATTEMPTS_PER_CANDIDATE : 1;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const selectedCandidate =
				candidate ??
				(modelRegistry ? getFirstValidAgentModelCandidate(agent, modelRegistry) : undefined);
			const runtimeSettings = getAgentRuntimeSettings(
				selectedCandidate ? { ...agent, model: selectedCandidate.id } : agent,
			);
			const attemptSession =
				parentSessionInfo && !request.resume && shouldTrackAttempts
					? (() => {
							const nextSession = getSubagentSessionPath(
								parentSessionInfo.sessionFile,
								parentSessionInfo.sessionId,
								runCwd,
							);
							return {
								...nextSession,
								cliSession: { file: nextSession.sessionFile } as const,
							};
						})()
					: subagentSession;
			const args = buildSingleAgentArgs(
				agent.name,
				request.task,
				selectedCandidate,
				attemptSession?.cliSession,
			);

			currentResult = {
				agent: request.agent,
				agentSource: agent.source,
				task: request.task,
				resumed: Boolean(request.resume),
				exitCode: 0,
				messages: [],
				stderr: "",
				usage: createEmptyUsage(),
				sessionFile: attemptSession?.sessionFile,
				sessionId: attemptSession?.sessionId,
				thinkingLevel: runtimeSettings.thinkingLevel,
			};

			const result = currentResult;
			const emitUpdate = () => onUpdate?.({ ...result, messages: [...result.messages] });

			const exitCode = await new Promise<number>((resolve) => {
				const invocation = getPiInvocation(args);
				const proc = spawn(invocation.command, invocation.args, {
					cwd: runCwd,
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
					env: {
						...process.env,
						PI_SUBAGENT: "1",
					},
				});
				let buffer = "";

				const processLine = (line: string) => {
					if (!line.trim()) return;

					let event: unknown;
					try {
						event = JSON.parse(line);
					} catch {
						return;
					}

					if (
						typeof event !== "object" ||
						event === null ||
						!("type" in event) ||
						typeof event.type !== "string"
					) {
						return;
					}

					if (event.type === "session" && "id" in event && typeof event.id === "string") {
						result.sessionId = event.id;
						emitUpdate();
						return;
					}

					if (event.type === "message_end" && "message" in event && event.message) {
						const msg = event.message as Message;
						result.messages.push(msg);

						if (msg.role === "assistant") {
							result.usage.turns++;
							const usage = msg.usage;
							if (usage) {
								result.usage.input += usage.input || 0;
								result.usage.output += usage.output || 0;
								result.usage.cacheRead += usage.cacheRead || 0;
								result.usage.cacheWrite += usage.cacheWrite || 0;
								result.usage.cost += usage.cost?.total || 0;
								result.usage.contextTokens = usage.totalTokens || 0;
							}
							if (msg.provider) result.provider = msg.provider;
							if (msg.model) result.model = msg.model;
							const modelInfo = resolveModelInfo?.(result.provider, result.model);
							if (modelInfo) {
								result.usage.contextWindow = modelInfo.contextWindow;
								result.reasoning = modelInfo.reasoning;
								result.usingSubscription = modelInfo.usingSubscription;
							}
							if (result.usage.contextWindow && result.usage.contextTokens > 0) {
								result.usage.contextPercent =
									(result.usage.contextTokens / result.usage.contextWindow) * 100;
							}
							if (msg.stopReason) result.stopReason = msg.stopReason;
							if (msg.errorMessage) result.errorMessage = msg.errorMessage;
						}
						emitUpdate();
						return;
					}

					if (event.type === "tool_result_end" && "message" in event && event.message) {
						result.messages.push(event.message as Message);
						emitUpdate();
					}
				};

				proc.stdout.on("data", (data) => {
					buffer += data.toString();
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) processLine(line);
				});

				proc.stderr.on("data", (data) => {
					result.stderr += data.toString();
				});

				proc.on("close", (code) => {
					if (buffer.trim()) processLine(buffer);
					resolve(code ?? 0);
				});

				proc.on("error", () => {
					resolve(1);
				});

				if (signal) {
					const killProc = () => {
						wasAborted = true;
						proc.kill("SIGTERM");
						setTimeout(() => {
							if (!proc.killed) proc.kill("SIGKILL");
						}, 5000);
					};
					if (signal.aborted) killProc();
					else signal.addEventListener("abort", killProc, { once: true });
				}
			});

			currentResult.exitCode = exitCode;
			if (wasAborted) throw new Error("Subagent was aborted");

			const kind = classifyModelChainResult(currentResult);
			const attemptMetadata: AttemptMetadata | undefined = shouldTrackAttempts
				? {
						attemptedModel: selectedCandidate?.id ?? "inherited model",
						attempt,
						success: kind === "success",
						exitCode,
						error: summarizeFailure(currentResult),
						retryable: isRetryableFailure(kind),
					}
				: undefined;
			if (attemptMetadata) {
				if (attemptMetadata.success) delete attemptMetadata.error;
				if (attemptMetadata.retryable === undefined) delete attemptMetadata.retryable;
				attempts.push(attemptMetadata);
				currentResult.attempts = attempts;
			}
			finalSubagentSession = attemptSession;
			if (kind === "success" || kind === "other") break;
			if (kind === "context_overflow") {
				currentResult.stderr =
					"Subagent context window overflow. Reduce the delegated task scope or provide narrower input.";
				if (attemptMetadata) attemptMetadata.error = summarizeFailure(currentResult);
				terminalContextOverflow = true;
				break;
			}
			if (kind === "deterministic") break;
			if (kind === "transient" && attempt < maxAttempts) continue;
			break;
		}
		if (!currentResult) continue;
		const kind = classifyModelChainResult(currentResult);
		if (kind === "success" || kind === "other" || terminalContextOverflow) break;
	}

	if (!currentResult) throw new Error("Subagent did not run");
	if (attempts.length) currentResult.attempts = attempts;
	if (classifyModelChainResult(currentResult) !== "success" && agent.modelCandidates?.length) {
		const terminalKind = classifyModelChainResult(currentResult);
		if (terminalKind !== "other" && terminalKind !== "context_overflow") {
			currentResult.stderr = `Subagent failed after exhausting model candidates. Attempts: ${attempts.map(formatAttemptFailure).join(" | ")}`;
		}
	}
	if (parentSessionInfo && finalSubagentSession) {
		const manifestId =
			currentResult.sessionId ??
			finalSubagentSession.sessionId ??
			path.basename(finalSubagentSession.sessionFile, ".jsonl");
		await updateManifest(
			finalSubagentSession.dir,
			{
				sessionFile: parentSessionInfo.sessionFile,
				sessionId: parentSessionInfo.sessionId,
			},
			runCwd,
			{
				id: manifestId,
				agent: currentResult.agent,
				agentSource: currentResult.agentSource,
				provider: currentResult.provider,
				model: currentResult.model,
				thinking: currentResult.thinkingLevel ?? null,
				description: request.description,
				prompt: currentResult.task,
				sessionFile: path.basename(finalSubagentSession.sessionFile),
				timestamp: new Date().toISOString(),
				exitCode: currentResult.exitCode,
				usage: {
					input: currentResult.usage.input,
					output: currentResult.usage.output,
					cost: currentResult.usage.cost,
				},
				durationMs: Date.now() - startTime,
				...(currentResult.attempts ? { attempts: currentResult.attempts } : {}),
			},
		);
	}
	return currentResult;
}

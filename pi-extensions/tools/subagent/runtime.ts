import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import {
	getAgentRuntimeSettings,
	getFirstValidAgentModelCandidate,
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
	const selectedCandidate = modelRegistry
		? getFirstValidAgentModelCandidate(agent, modelRegistry)
		: agent.modelCandidates?.[0];
	const runtimeSettings = getAgentRuntimeSettings(
		selectedCandidate ? { ...agent, model: selectedCandidate.id } : agent,
	);
	const args = buildSingleAgentArgs(
		agent.name,
		request.task,
		selectedCandidate,
		subagentSession?.cliSession,
	);
	const startTime = Date.now();

	const currentResult: SingleResult = {
		agent: request.agent,
		agentSource: agent.source,
		task: request.task,
		resumed: Boolean(request.resume),
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: createEmptyUsage(),
		sessionFile: subagentSession?.sessionFile,
		sessionId: subagentSession?.sessionId,
		thinkingLevel: runtimeSettings.thinkingLevel,
	};

	const emitUpdate = () => onUpdate?.({ ...currentResult, messages: [...currentResult.messages] });

	let wasAborted = false;

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
				currentResult.sessionId = event.id;
				emitUpdate();
				return;
			}

			if (event.type === "message_end" && "message" in event && event.message) {
				const msg = event.message as Message;
				currentResult.messages.push(msg);

				if (msg.role === "assistant") {
					currentResult.usage.turns++;
					const usage = msg.usage;
					if (usage) {
						currentResult.usage.input += usage.input || 0;
						currentResult.usage.output += usage.output || 0;
						currentResult.usage.cacheRead += usage.cacheRead || 0;
						currentResult.usage.cacheWrite += usage.cacheWrite || 0;
						currentResult.usage.cost += usage.cost?.total || 0;
						currentResult.usage.contextTokens = usage.totalTokens || 0;
					}
					if (msg.provider) currentResult.provider = msg.provider;
					if (msg.model) currentResult.model = msg.model;
					const modelInfo = resolveModelInfo?.(currentResult.provider, currentResult.model);
					if (modelInfo) {
						currentResult.usage.contextWindow = modelInfo.contextWindow;
						currentResult.reasoning = modelInfo.reasoning;
						currentResult.usingSubscription = modelInfo.usingSubscription;
					}
					if (currentResult.usage.contextWindow && currentResult.usage.contextTokens > 0) {
						currentResult.usage.contextPercent =
							(currentResult.usage.contextTokens / currentResult.usage.contextWindow) * 100;
					}
					if (msg.stopReason) currentResult.stopReason = msg.stopReason;
					if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
				}
				emitUpdate();
				return;
			}

			if (event.type === "tool_result_end" && "message" in event && event.message) {
				currentResult.messages.push(event.message as Message);
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
			currentResult.stderr += data.toString();
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
	if (parentSessionInfo && subagentSession) {
		const manifestId =
			currentResult.sessionId ??
			subagentSession.sessionId ??
			path.basename(subagentSession.sessionFile, ".jsonl");
		await updateManifest(
			subagentSession.dir,
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
				sessionFile: path.basename(subagentSession.sessionFile),
				timestamp: new Date().toISOString(),
				exitCode: currentResult.exitCode,
				usage: {
					input: currentResult.usage.input,
					output: currentResult.usage.output,
					cost: currentResult.usage.cost,
				},
				durationMs: Date.now() - startTime,
			},
		);
	}
	return currentResult;
}

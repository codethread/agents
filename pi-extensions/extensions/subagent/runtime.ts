import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "./agents.js";
import { getSubagentSessionPath, updateManifest } from "./session.js";
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

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

export async function writePromptToTempFile(
	agentName: string,
	prompt: string,
): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

export async function runSingleAgent(
	agents: AgentConfig[],
	request: TaskRequest,
	signal: AbortSignal | undefined,
	onUpdate: ((result: SingleResult) => void) | undefined,
	resolveModelInfo?: ResolveModelInfo,
	parentSessionInfo?: ParentSessionInfo,
): Promise<SingleResult> {
	const agent = agents.find((candidate) => candidate.name === request.agent);
	if (!agent) return createUnknownAgentResult(request.agent, request.task, agents);

	const args: string[] = ["--mode", "json", "-p"];
	const runCwd = request.cwd;
	let subagentSession:
		| {
				dir: string;
				sessionFile: string;
				sessionId: string;
		  }
		| undefined;
	if (parentSessionInfo) {
		subagentSession = getSubagentSessionPath(
			parentSessionInfo.sessionFile,
			parentSessionInfo.sessionId,
			runCwd,
		);
		args.push("--session", subagentSession.sessionFile);
	} else {
		args.push("--no-session");
	}
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools?.length) args.push("--tools", agent.tools.join(","));

	const startTime = Date.now();

	const currentResult: SingleResult = {
		agent: request.agent,
		agentSource: agent.source,
		task: request.task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: createEmptyUsage(),
		sessionFile: subagentSession?.sessionFile,
		thinkingLevel: agent.model?.split(":").at(1),
	};

	const emitUpdate = () => onUpdate?.({ ...currentResult, messages: [...currentResult.messages] });
	let tmpPromptDir: string | null = null;

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			args.push("--append-system-prompt", tmp.filePath);
		}

		args.push(`Task: ${request.task}`);
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: runCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
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
			await updateManifest(
				subagentSession.dir,
				{
					sessionFile: parentSessionInfo.sessionFile,
					sessionId: parentSessionInfo.sessionId,
				},
				runCwd,
				{
					id: subagentSession.sessionId,
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
	} finally {
		if (tmpPromptDir) {
			await fs.promises.rm(tmpPromptDir, { recursive: true, force: true });
		}
	}
}

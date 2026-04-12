/**
 * Subagent tool - delegate tasks to specialized agents.
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports two modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { getMarkdownTheme, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	formatContextDisplay,
	formatCost,
	formatModelDisplay,
} from "../current-context-footer/usage-format.js";
import { discoverAgents, formatAgentsForPrompt } from "./agents.js";
import type { AgentConfig } from "./agents.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
const RUNNING_EXIT_CODE = -1;

type SubagentMode = "single" | "parallel";
type AgentSource = AgentConfig["source"] | "unknown";

type TaskRequest = {
	agent: string;
	task: string;
	description?: string;
	cwd?: string;
};

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	contextWindow?: number;
	contextPercent?: number | null;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: AgentSource;
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	sessionFile?: string;
	provider?: string;
	model?: string;
	reasoning?: boolean;
	usingSubscription?: boolean;
	thinkingLevel?: string;
	stopReason?: string;
	errorMessage?: string;
}

interface ManifestEntry {
	id: string;
	agent: string;
	agentSource: string;
	provider?: string;
	model?: string;
	thinking: string | null;
	description: string;
	prompt: string;
	sessionFile: string;
	timestamp: string;
	exitCode: number;
	usage: { input: number; output: number; cost: number };
	durationMs: number;
}

interface Manifest {
	parent: {
		sessionFile: string;
		sessionId: string;
	};
	cwd: string;
	subagents: ManifestEntry[];
}

interface SubagentDetails {
	mode: SubagentMode;
	projectAgentsDir: string | null;
	parentSessionId?: string;
	results: SingleResult[];
}

type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

type ResolveModelInfo = (
	provider: string | undefined,
	model: string | undefined,
) => { contextWindow?: number; reasoning?: boolean; usingSubscription?: boolean } | undefined;

function createEmptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

function createUnknownAgentResult(
	agentName: string,
	task: string,
	agents: AgentConfig[],
): SingleResult {
	const available = agents.map((agent) => `"${agent.name}"`).join(", ") || "none";
	return {
		agent: agentName,
		agentSource: "unknown",
		task,
		exitCode: 1,
		messages: [],
		stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
		usage: createEmptyUsage(),
	};
}

function createPendingResult(task: TaskRequest): SingleResult {
	return {
		agent: task.agent,
		agentSource: "unknown",
		task: task.task,
		exitCode: RUNNING_EXIT_CODE,
		messages: [],
		stderr: "",
		usage: createEmptyUsage(),
	};
}

function createDetails(
	mode: SubagentMode,
	projectAgentsDir: string | null,
	results: SingleResult[],
	parentSessionId?: string,
): SubagentDetails {
	return {
		mode,
		projectAgentsDir,
		parentSessionId,
		results,
	};
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		contextWindow?: number;
		contextPercent?: number | null;
		turns?: number;
	},
	options?: {
		provider?: string;
		model?: string;
		thinkingLevel?: string;
		reasoning?: boolean;
		usingSubscription?: boolean;
	},
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.contextTokens || usage.contextWindow) {
		parts.push(
			formatContextDisplay({
				contextTokens: usage.contextTokens,
				contextWindow: usage.contextWindow,
				contextPercent: usage.contextPercent,
			}),
		);
	}
	if (usage.cost || options?.usingSubscription)
		parts.push(formatCost(usage.cost, options?.usingSubscription, 4));
	if (options?.model) {
		parts.push(
			formatModelDisplay({
				provider: options.provider,
				model: options.model,
				thinkingLevel: options.thinkingLevel,
				reasoning: options.reasoning,
				includeProvider: Boolean(options.provider),
			}),
		);
	}
	return parts.join(" ");
}

function shortenHomePath(p: string): string {
	const home = os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenHomePath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenHomePath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenHomePath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenHomePath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "find ") +
				themeFg("accent", pattern) +
				themeFg("dim", ` in ${shortenHomePath(rawPath)}`)
			);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenHomePath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

function isResultError(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

function getResultErrorText(result: SingleResult): string {
	return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text") return part.text;
		}
	}
	return "";
}

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text") items.push({ type: "text", text: part.text });
			else if (part.type === "toolCall") {
				items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

function aggregateUsage(results: SingleResult[]) {
	const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
	for (const result of results) {
		total.input += result.usage.input;
		total.output += result.usage.output;
		total.cacheRead += result.usage.cacheRead;
		total.cacheWrite += result.usage.cacheWrite;
		total.cost += result.usage.cost;
		total.turns += result.usage.turns;
	}
	return total;
}

function getAvailableAgentsText(agents: AgentConfig[]): string {
	return agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
}

function getRequestedAgentNames(params: { agent?: string; tasks?: TaskRequest[] }): string[] {
	const names = new Set<string>();
	if (params.agent) names.add(params.agent);
	for (const task of params.tasks ?? []) names.add(task.agent);
	return Array.from(names);
}

function formatDebugSection(title: string, agents: AgentConfig[]): string {
	const lines = [title];
	if (agents.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}

	for (const agent of agents) {
		lines.push(`- ${agent.name} [${agent.source}]`);
		lines.push(`  file: ${agent.filePath}`);
		if (agent.model) lines.push(`  resolved model: ${agent.model}`);
		if (agent.tools?.length) lines.push(`  normalized tools: ${agent.tools.join(", ")}`);
		else lines.push("  normalized tools: (default toolset)");
	}
	return lines.join("\n");
}

function getResultUsageOptions(result: SingleResult) {
	return {
		provider: result.provider,
		model: result.model,
		thinkingLevel: result.thinkingLevel,
		reasoning: result.reasoning,
		usingSubscription: result.usingSubscription,
	};
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
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

type ParentSessionInfo = { sessionFile: string; sessionId: string; cwd: string };

function getSubagentSessionPath(
	parentSessionFile: string,
	parentSessionId: string,
	cwd: string,
): { dir: string; sessionFile: string; sessionId: string } {
	const encodedCwd = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const agentDir = path.join(os.homedir(), ".pi", "agent");
	const dir = path.join(agentDir, "subagent-sessions", encodedCwd, parentSessionId);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const sessionId = randomUUID();
	return {
		dir,
		sessionFile: path.join(dir, `${sessionId}.jsonl`),
		sessionId,
	};
}

async function updateManifest(
	dir: string,
	parentInfo: { sessionFile: string; sessionId: string },
	cwd: string,
	entry: ManifestEntry,
): Promise<void> {
	const manifestPath = path.join(dir, "manifest.json");
	let manifest: Manifest = {
		parent: {
			sessionFile: parentInfo.sessionFile,
			sessionId: parentInfo.sessionId,
		},
		cwd,
		subagents: [],
	};

	try {
		const raw = await fs.promises.readFile(manifestPath, "utf8");
		const parsed = JSON.parse(raw) as Partial<Manifest>;
		manifest = {
			parent: parsed.parent ?? manifest.parent,
			cwd: parsed.cwd ?? manifest.cwd,
			subagents: Array.isArray(parsed.subagents) ? parsed.subagents : [],
		};
	} catch {
		// create new manifest on first run or malformed content
	}

	manifest.parent = {
		sessionFile: parentInfo.sessionFile,
		sessionId: parentInfo.sessionId,
	};
	manifest.cwd = cwd;
	const existingIndex = manifest.subagents.findIndex((subagent) => subagent.id === entry.id);
	if (existingIndex >= 0) manifest.subagents[existingIndex] = entry;
	else manifest.subagents.push(entry);

	await withFileMutationQueue(manifestPath, async () => {
		await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	});
}

async function mapWithConcurrencyLimit<TIn, TOut>(
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

async function writePromptToTempFile(
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

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	request: TaskRequest,
	description: string,
	signal: AbortSignal | undefined,
	onUpdate: ((result: SingleResult) => void) | undefined,
	resolveModelInfo?: ResolveModelInfo,
	parentSessionInfo?: ParentSessionInfo,
): Promise<SingleResult> {
	const agent = agents.find((candidate) => candidate.name === request.agent);
	if (!agent) return createUnknownAgentResult(request.agent, request.task, agents);

	const args: string[] = ["--mode", "json", "-p"];
	const runCwd = request.cwd ?? defaultCwd;
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
					description,
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

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	description: Type.String({
		description:
			"Terse summary of the delegated task (3-8 words), e.g. 'map auth flow in db connector'",
	}),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({ description: "Name of the agent to invoke (for single mode)" }),
	),
	description: Type.Optional(
		Type.String({
			description:
				"Terse summary of the delegated task (3-8 words), e.g. 'map auth flow in db connector'",
		}),
	),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, description, task} for parallel execution",
		}),
	),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({
			description: "Prompt before running project-local agents. Default: true.",
			default: true,
		}),
	),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the agent process (single mode)" }),
	),
});

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const discovery = discoverAgents(ctx.cwd);
		const promptAddon = formatAgentsForPrompt(discovery.agents);
		if (!promptAddon) return;
		return {
			systemPrompt: `${event.systemPrompt}${promptAddon}`,
		};
	});

	pi.registerCommand("debug-agents", {
		description: "Send discovered subagent information into the conversation",
		handler: async (_args, ctx) => {
			const discovery = discoverAgents(ctx.cwd);
			const sections = [
				formatDebugSection("Available agents:", discovery.agents),
				formatDebugSection("User agents:", discovery.userAgents),
				[
					`Project agents dir: ${discovery.projectAgentsDir ?? "(none)"}`,
					formatDebugSection("Project agents:", discovery.projectAgents),
				].join("\n"),
			];

			const content = `Here are the currently discovered subagents:\n\n${sections.join("\n\n")}`;

			if (!ctx.isIdle()) {
				pi.sendUserMessage(content, { deliverAs: "followUp" });
				if (ctx.hasUI) ctx.ui.notify("Queued agent debug info as follow-up", "info");
				return;
			}

			pi.sendUserMessage(content);
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + description + task), parallel (tasks array; each task includes description + task).",
			"A terse description field is required for delegated tasks.",
			"Bundled, user, and project agents are discovered automatically.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const discovery = discoverAgents(ctx.cwd);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task && params.description);
			const singleFieldsPresent = Boolean(params.agent || params.task || params.description);
			const modeCount = Number(hasTasks) + Number(hasSingle);
			const parentSessionFile = ctx.sessionManager.getSessionFile();
			const parentSessionId = ctx.sessionManager.getSessionId();
			const parentSessionInfo = parentSessionFile
				? { sessionFile: parentSessionFile, sessionId: parentSessionId, cwd: ctx.cwd }
				: undefined;
			const makeDetails = (mode: SubagentMode, results: SingleResult[]) =>
				createDetails(mode, discovery.projectAgentsDir, results, parentSessionInfo?.sessionId);
			const resolveModelInfo: ResolveModelInfo = (provider, model) => {
				if (!provider || !model) return undefined;
				const resolved = ctx.modelRegistry.find(provider, model);
				if (!resolved) return undefined;
				return {
					contextWindow: resolved.contextWindow,
					reasoning: resolved.reasoning,
					usingSubscription: ctx.modelRegistry.isUsingOAuth(resolved),
				};
			};

			if (modeCount !== 1) {
				const missingDescription = singleFieldsPresent && !hasSingle && !hasTasks;
				const guidance = missingDescription
					? "Single mode requires agent, description, and task."
					: "Provide exactly one mode.";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. ${guidance}\nAvailable agents: ${getAvailableAgentsText(agents)}`,
						},
					],
					details: makeDetails("single", []),
				};
			}

			if (confirmProjectAgents && ctx.hasUI) {
				const requestedAgentNames = getRequestedAgentNames({
					agent: params.agent,
					tasks: params.tasks,
				});
				const projectAgentsRequested = requestedAgentNames
					.map((name) => agents.find((agent) => agent.name === name))
					.filter((agent): agent is AgentConfig => agent?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((agent) => agent.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok) {
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(hasTasks ? "parallel" : "single", []),
						};
					}
				}
			}

			if (params.tasks?.length) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel", []),
					};
				}

				const allResults = params.tasks.map(createPendingResult);
				const emitParallelUpdate = () => {
					if (!onUpdate) return;
					const running = allResults.filter(
						(result) => result.exitCode === RUNNING_EXIT_CODE,
					).length;
					const done = allResults.length - running;
					onUpdate({
						content: [
							{
								type: "text",
								text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
							},
						],
						details: makeDetails("parallel", [...allResults]),
					});
				};

				const results = await mapWithConcurrencyLimit(
					params.tasks,
					MAX_CONCURRENCY,
					async (task, index) => {
						const result = await runSingleAgent(
							ctx.cwd,
							agents,
							task,
							task.description,
							signal,
							(partial) => {
								allResults[index] = partial;
								emitParallelUpdate();
							},
							resolveModelInfo,
							parentSessionInfo,
						);
						allResults[index] = result;
						emitParallelUpdate();
						return result;
					},
				);

				const successCount = results.filter((result) => result.exitCode === 0).length;
				const summaries = results.map((result) => {
					const output = getFinalOutput(result.messages);
					const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
					return `[${result.agent}] ${result.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
						},
					],
					details: makeDetails("parallel", results),
				};
			}

			if (params.agent && params.task && params.description) {
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					{ agent: params.agent, task: params.task, cwd: params.cwd },
					params.description,
					signal,
					(partial) => {
						if (!onUpdate) return;
						onUpdate({
							content: [{ type: "text", text: getFinalOutput(partial.messages) || "(running...)" }],
							details: makeDetails("single", [partial]),
						});
					},
					resolveModelInfo,
					parentSessionInfo,
				);

				if (isResultError(result)) {
					return {
						content: [
							{
								type: "text",
								text: `Agent ${result.stopReason || "failed"}: ${getResultErrorText(result)}`,
							},
						],
						details: makeDetails("single", [result]),
						isError: true,
					};
				}

				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single", [result]),
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Invalid parameters. Available agents: ${getAvailableAgentsText(agents)}`,
					},
				],
				details: makeDetails("single", []),
			};
		},

		renderCall(args, theme, _context) {
			if (args.tasks?.length) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`);
				for (const task of args.tasks.slice(0, 3)) {
					const preview = task.task.length > 40 ? `${task.task.slice(0, 40)}...` : task.task;
					text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) {
					text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				}
				return new Text(text, 0, 0);
			}

			const agentName = args.agent || "...";
			const preview =
				args.task && args.task.length > 60 ? `${args.task.slice(0, 60)}...` : (args.task ?? "...");
			let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", agentName);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details?.results.length) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();
			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};
			const addToolCallsAndOutput = (container: Container, singleResult: SingleResult) => {
				const displayItems = getDisplayItems(singleResult.messages);
				const finalOutput = getFinalOutput(singleResult.messages);

				if (displayItems.length === 0 && !finalOutput) {
					container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					return;
				}

				for (const item of displayItems) {
					if (item.type !== "toolCall") continue;
					container.addChild(
						new Text(
							theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
							0,
							0,
						),
					);
				}
				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
				}
			};

			if (details.mode === "single") {
				const singleResult = details.results[0];
				const error = isResultError(singleResult);
				const icon = error ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(singleResult.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(singleResult.agent))}${theme.fg("muted", ` (${singleResult.agentSource})`)}`;
					if (error && singleResult.stopReason) {
						header += ` ${theme.fg("error", `[${singleResult.stopReason}]`)}`;
					}
					container.addChild(new Text(header, 0, 0));
					if (error && singleResult.errorMessage) {
						container.addChild(
							new Text(theme.fg("error", `Error: ${singleResult.errorMessage}`), 0, 0),
						);
					}
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", singleResult.task), 0, 0));
					if (singleResult.sessionFile) {
						container.addChild(
							new Text(
								theme.fg("muted", "session: ") +
									theme.fg("dim", shortenHomePath(singleResult.sessionFile)),
								0,
								0,
							),
						);
					}
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					addToolCallsAndOutput(container, singleResult);
					const usageStr = formatUsageStats(
						singleResult.usage,
						getResultUsageOptions(singleResult),
					);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(singleResult.agent))}${theme.fg("muted", ` (${singleResult.agentSource})`)}`;
				if (error && singleResult.stopReason) {
					text += ` ${theme.fg("error", `[${singleResult.stopReason}]`)}`;
				}
				if (error && singleResult.errorMessage) {
					text += `\n${theme.fg("error", `Error: ${singleResult.errorMessage}`)}`;
				} else if (displayItems.length === 0) {
					text += `\n${theme.fg("muted", "(no output)")}`;
				} else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) {
						text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
					}
				}
				const usageStr = formatUsageStats(singleResult.usage, getResultUsageOptions(singleResult));
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			const running = details.results.filter(
				(singleResult) => singleResult.exitCode === RUNNING_EXIT_CODE,
			).length;
			const successCount = details.results.filter(
				(singleResult) => singleResult.exitCode === 0,
			).length;
			const failCount = details.results.filter(
				(singleResult) =>
					singleResult.exitCode !== RUNNING_EXIT_CODE && isResultError(singleResult),
			).length;
			const isRunning = running > 0;
			const icon = isRunning
				? theme.fg("warning", "⏳")
				: failCount > 0
					? theme.fg("warning", "◐")
					: theme.fg("success", "✓");
			const status = isRunning
				? `${successCount + failCount}/${details.results.length} done, ${running} running`
				: `${successCount}/${details.results.length} tasks`;

			if (expanded && !isRunning) {
				const container = new Container();
				container.addChild(
					new Text(
						`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
						0,
						0,
					),
				);

				for (const singleResult of details.results) {
					const resultIcon = isResultError(singleResult)
						? theme.fg("error", "✗")
						: theme.fg("success", "✓");
					container.addChild(new Spacer(1));
					container.addChild(
						new Text(
							`${theme.fg("muted", "─── ") + theme.fg("accent", singleResult.agent)} ${resultIcon}`,
							0,
							0,
						),
					);
					container.addChild(
						new Text(theme.fg("muted", "Task: ") + theme.fg("dim", singleResult.task), 0, 0),
					);
					if (singleResult.sessionFile) {
						container.addChild(
							new Text(
								theme.fg("muted", "session: ") +
									theme.fg("dim", shortenHomePath(singleResult.sessionFile)),
								0,
								0,
							),
						);
					}
					addToolCallsAndOutput(container, singleResult);
					const usageStr = formatUsageStats(
						singleResult.usage,
						getResultUsageOptions(singleResult),
					);
					if (usageStr) {
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
				}

				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
				}
				return container;
			}

			let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
			for (const singleResult of details.results) {
				const resultIcon =
					singleResult.exitCode === RUNNING_EXIT_CODE
						? theme.fg("warning", "⏳")
						: isResultError(singleResult)
							? theme.fg("error", "✗")
							: theme.fg("success", "✓");
				const displayItems = getDisplayItems(singleResult.messages);
				text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", singleResult.agent)} ${resultIcon}`;
				if (displayItems.length === 0) {
					text += `\n${theme.fg("muted", singleResult.exitCode === RUNNING_EXIT_CODE ? "(running...)" : "(no output)")}`;
				} else {
					text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
			}
			if (!isRunning) {
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
			}
			if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
			return new Text(text, 0, 0);
		},
	});
}

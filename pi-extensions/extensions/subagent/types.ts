import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig } from "./agents.js";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const COLLAPSED_ITEM_COUNT = 10;
export const RUNNING_EXIT_CODE = -1;

export type SubagentMode = "single" | "parallel";
export type AgentSource = AgentConfig["source"] | "unknown";

export type TaskRequest = {
	agent: string;
	task: string;
	description?: string;
	cwd?: string;
};

export interface UsageStats {
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

export interface SingleResult {
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

export interface SubagentDetails {
	mode: SubagentMode;
	projectAgentsDir: string | null;
	parentSessionId?: string;
	results: SingleResult[];
}

export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

export type ResolveModelInfo = (
	provider: string | undefined,
	model: string | undefined,
) => { contextWindow?: number; reasoning?: boolean; usingSubscription?: boolean } | undefined;

export type ParentSessionInfo = { sessionFile: string; sessionId: string; cwd: string };

export function createEmptyUsage(): UsageStats {
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

export function createUnknownAgentResult(
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

export function createPendingResult(task: TaskRequest): SingleResult {
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

export function createDetails(
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

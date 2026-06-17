import { describe, expect, it } from "vitest";
import type { AgentConfig, SwarmConfig } from "./agents.js";
import type { TaskRequest } from "./types.js";
import {
	createMissingSwarmMemberResult,
	createRuntimeModelPolicyFailureResult,
	findSwarmMemberResumeState,
	formatMcpStatusPrompt,
	formatRuntimeModelPolicyError,
	formatUnknownTargetError,
	getStartupModelPolicyErrors,
	hasAllSwarmMembersFailed,
	isLikelyFollowUpRequest,
} from "./index.js";
import { getAvailableAgentsText, getAvailableSwarmsText } from "./render.js";

function makeAgent(name: string, source: AgentConfig["source"]): AgentConfig {
	return {
		name,
		description: `${name} specialist`,
		hidden: false,
		tools: [],
		systemPrompt: `You are ${name}.`,
		source,
		filePath: `/tmp/${name}.md`,
	};
}

function makeSwarm(name: string, source: SwarmConfig["source"]): SwarmConfig {
	return {
		name,
		description: `${name} panel`,
		hidden: false,
		members: ["scout", "hack"],
		source,
		filePath: `/tmp/${name}/swarm.json`,
	};
}

describe("swarm helper functions", () => {
	it("detects follow-up-like task prompts", () => {
		expect(isLikelyFollowUpRequest("Look at this prior failure", "Investigate previous bug")).toBe(
			true,
		);
		expect(
			isLikelyFollowUpRequest("Run a fresh scan and report back", "Generate baseline diff"),
		).toBe(false);
	});

	it("finds a matching swarm member state by name", () => {
		const state = [
			{ name: "scout", sessionId: "id-1", sessionFile: "scout.jsonl" },
			{ name: "hack", sessionId: "id-2", sessionFile: "hack.jsonl" },
		];
		expect(findSwarmMemberResumeState(state, "hack")).toEqual({
			name: "hack",
			sessionId: "id-2",
			sessionFile: "hack.jsonl",
		});
		expect(findSwarmMemberResumeState(state, "reviewer")).toBeUndefined();
	});

	it("creates a missing-session swarm member result with resume context", () => {
		const params: TaskRequest = {
			agent: "scout",
			description: "Review review",
			task: "Review this module",
			cwd: "/repo",
		};
		const result = createMissingSwarmMemberResult(params, "hack", "swarm-review-abc", {
			name: "hack",
			sessionId: "old-session-id",
			sessionFile: "old.jsonl",
		});

		expect(result).toMatchObject({
			agent: "hack",
			agentSource: "unknown",
			task: "Review this module",
			resumed: true,
			exitCode: 1,
			messages: [],
			stderr: 'No session found for swarm member "hack" in resume "swarm-review-abc".',
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				contextTokens: 0,
				turns: 0,
			},
			sessionId: "old-session-id",
			sessionFile: "old.jsonl",
		});
	});
});

describe("runtime model policy validation", () => {
	const modelRegistry = {
		find: (provider: string, model: string) =>
			provider === "openai" && model === "gpt-5.4-mini" ? { provider, id: model } : undefined,
		getAll: () => [{ provider: "openai", id: "gpt-5.4-mini" }],
		hasConfiguredAuth: () => true,
	};

	it("validates only the requested target and ignores unrelated invalid agents", () => {
		const valid = {
			...makeAgent("valid", "project"),
			model: "openai/gpt-5.4-mini:low",
			modelCandidates: [{ id: "openai/gpt-5.4-mini:low" }],
		};
		const unrelatedInvalid = {
			...makeAgent("broken", "project"),
			modelPolicyError: 'Invalid model policy for agent "broken" at /tmp/broken.md: bad',
		};

		expect(formatRuntimeModelPolicyError(valid, modelRegistry)).toBeUndefined();
		expect(formatRuntimeModelPolicyError(unrelatedInvalid, modelRegistry)).toContain(
			"Subagent broken failed",
		);
	});

	it("scopes delegated child startup validation to the selected --agent", () => {
		const selected = {
			...makeAgent("valid", "project"),
			model: "openai/gpt-5.4-mini:low",
			modelCandidates: [{ id: "openai/gpt-5.4-mini:low" }],
		};
		const unrelatedInvalid = {
			...makeAgent("broken", "project"),
			modelPolicyError: 'Invalid model policy for agent "broken" at /tmp/broken.md: bad',
		};
		const discovery = {
			agents: [selected, unrelatedInvalid],
			userAgents: [],
			projectAgents: [selected, unrelatedInvalid],
			projectAgentsDir: "/tmp/.pi/agents",
			extensionAgents: [],
			extensionAgentRoots: [],
			swarms: [],
			userSwarms: [],
			projectSwarms: [],
			projectSwarmsDir: null,
			extensionSwarms: [],
		};

		expect(getStartupModelPolicyErrors(discovery, modelRegistry, "valid", true)).toEqual([]);
		expect(getStartupModelPolicyErrors(discovery, modelRegistry, "valid", false)).toEqual([
			'Invalid model policy for agent "broken" at /tmp/broken.md: bad',
		]);
	});

	it("returns a clear failure result for an invalid requested single agent", () => {
		const invalid = {
			...makeAgent("broken", "user"),
			modelPolicyError: 'Invalid model policy for agent "broken" at /tmp/broken.md: bad',
		};

		const result = createRuntimeModelPolicyFailureResult(
			{ agent: "broken", description: "run broken", task: "Do work", cwd: "/repo" },
			invalid,
			modelRegistry,
		);

		expect(result).toMatchObject({
			agent: "broken",
			agentSource: "user",
			exitCode: 1,
			stderr: expect.stringContaining("Subagent broken failed"),
		});
		expect(result?.stderr).toContain("/tmp/broken.md");
	});

	it("represents invalid swarm members as member-level failures", () => {
		const invalidMember = {
			...makeAgent("invalid-member", "project"),
			model: "missing/model:high",
			modelCandidates: [{ id: "missing/model:high" }],
		};

		const result = createRuntimeModelPolicyFailureResult(
			{ agent: "invalid-member", description: "run swarm", task: "Review", cwd: "/repo" },
			invalidMember,
			modelRegistry,
		);

		expect(result).toMatchObject({ agent: "invalid-member", exitCode: 1 });
		expect(result?.stderr).toContain("Subagent invalid-member failed");
		expect(result?.stderr).toContain("no valid model candidates");
	});

	it("keeps mixed-validity swarm results as partial success", () => {
		const validResult = {
			agent: "valid-member",
			agentSource: "project" as const,
			task: "Review",
			exitCode: 0,
			messages: [],
			stderr: "",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				contextTokens: 0,
				turns: 0,
			},
		};
		const invalidMember = {
			...makeAgent("invalid-member", "project"),
			model: "missing/model:high",
			modelCandidates: [{ id: "missing/model:high" }],
		};
		const invalidResult = createRuntimeModelPolicyFailureResult(
			{ agent: "invalid-member", description: "run swarm", task: "Review", cwd: "/repo" },
			invalidMember,
			modelRegistry,
		)!;

		expect(hasAllSwarmMembersFailed([validResult, invalidResult])).toBe(false);
		expect(hasAllSwarmMembersFailed([invalidResult])).toBe(true);
	});
});

describe("formatUnknownTargetError", () => {
	it("reports unknown target with both agents and swarms", () => {
		const error = formatUnknownTargetError(
			"ghost",
			getAvailableAgentsText([makeAgent("scout", "package"), makeAgent("review", "user")]),
			getAvailableSwarmsText([makeSwarm("panel", "user")]),
		);

		expect(error).toBe(
			'Unknown subagent target "ghost". Available agents: scout (package), review (user). Available swarms: panel (user).',
		);
	});
});

describe("formatMcpStatusPrompt", () => {
	it("returns an empty string when there are no warnings", () => {
		expect(formatMcpStatusPrompt([])).toBe("");
	});

	it("wraps connection warnings in an mcp-status system reminder", () => {
		const result = formatMcpStatusPrompt([
			'MCP server "atlassian" for agent "jira-mcp" failed to connect: 401',
		]);
		expect(result).toContain('<system-reminder type="mcp-status">');
		expect(result).toContain("failed to connect: 401");
		expect(result).toContain("Do not pretend to have data");
	});
});

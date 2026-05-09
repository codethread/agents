import { describe, expect, it } from "vitest";
import type { AgentConfig, SwarmConfig } from "./agents.js";
import type { TaskRequest } from "./types.js";
import {
	createMissingSwarmMemberResult,
	findSwarmMemberResumeState,
	formatUnknownTargetError,
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

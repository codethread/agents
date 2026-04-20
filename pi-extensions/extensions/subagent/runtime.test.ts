import { describe, expect, it } from "vitest";
import { buildSingleAgentArgs } from "./runtime.js";

describe("buildSingleAgentArgs", () => {
	it("uses --agent so child runs inherit the exact agent config", () => {
		expect(buildSingleAgentArgs("scout", "Map the subagent flow")).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"scout",
			"--no-session",
			"Task: Map the subagent flow",
		]);
	});

	it("persists child sessions when a session file is provided", () => {
		expect(
			buildSingleAgentArgs("fixer", "Fix the typecheck errors", "/tmp/subagent.jsonl"),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"fixer",
			"--session",
			"/tmp/subagent.jsonl",
			"Task: Fix the typecheck errors",
		]);
	});
});

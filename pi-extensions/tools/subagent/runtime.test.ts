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

	it("passes an explicit candidate model without inherited thinking", () => {
		expect(
			buildSingleAgentArgs("fixer", "Fix the typecheck errors", {
				id: "openai/gpt-5.4-mini",
			}),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"fixer",
			"--model",
			"openai/gpt-5.4-mini",
			"--no-session",
			"Task: Fix the typecheck errors",
		]);
	});

	it("passes candidate-local thinking only when declared", () => {
		expect(
			buildSingleAgentArgs("fixer", "Fix the typecheck errors", {
				id: "openai/gpt-5.4-mini:low",
			}),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"fixer",
			"--model",
			"openai/gpt-5.4-mini",
			"--thinking",
			"low",
			"--no-session",
			"Task: Fix the typecheck errors",
		]);
	});

	it("keeps unrecognized suffixes in the model value", () => {
		expect(
			buildSingleAgentArgs("fixer", "Fix the typecheck errors", {
				id: "custom-provider/model:preview",
			}),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"fixer",
			"--model",
			"custom-provider/model:preview",
			"--no-session",
			"Task: Fix the typecheck errors",
		]);
	});

	it("persists child sessions when a session file is provided", () => {
		expect(
			buildSingleAgentArgs("fixer", "Fix the typecheck errors", undefined, {
				file: "/tmp/subagent.jsonl",
			}),
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

	it("resumes child sessions through Pi's session lookup", () => {
		expect(
			buildSingleAgentArgs(
				"review",
				"Review the fixes",
				{ id: "anthropic/claude-sonnet-4:medium" },
				{
					id: "session-id-123",
					dir: "/tmp/subagent-sessions",
				},
			),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"review",
			"--model",
			"anthropic/claude-sonnet-4",
			"--thinking",
			"medium",
			"--session",
			"session-id-123",
			"--session-dir",
			"/tmp/subagent-sessions",
			"Task: Review the fixes",
		]);
	});
});

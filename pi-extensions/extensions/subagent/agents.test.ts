import { describe, expect, it } from "vitest";
import { formatAgentsForPrompt, type AgentConfig } from "./agents.js";

describe("formatAgentsForPrompt", () => {
	it("returns an empty string when no subagents are available", () => {
		expect(formatAgentsForPrompt([])).toBe("");
	});

	it("formats subagents as an XML list with escaped names and descriptions", () => {
		const agents: AgentConfig[] = [
			{
				name: "worker",
				description: "General-purpose helper",
				systemPrompt: "prompt",
				source: "package",
				filePath: "/tmp/worker.md",
			},
			{
				name: "explore <fast>",
				description: "Map dirs & files > summarize",
				systemPrompt: "prompt",
				source: "user",
				filePath: "/tmp/explorer.md",
			},
		];

		expect(formatAgentsForPrompt(agents)).toBe(
			[
				"",
				"",
				"These are the available subagents with their intended use.",
				"",
				"<available_subagents>",
				"  <subagent>",
				"    <name>worker</name>",
				"    <description>General-purpose helper</description>",
				"  </subagent>",
				"  <subagent>",
				"    <name>explore &lt;fast&gt;</name>",
				"    <description>Map dirs &amp; files &gt; summarize</description>",
				"  </subagent>",
				"</available_subagents>",
			].join("\n"),
		);
	});
});

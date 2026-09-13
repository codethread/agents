import { describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { formatDebugToolReport, parseDebugToolNames } from "./tool-report.js";

const tools = [
	{
		name: "bash",
		description: "Execute a shell command.",
		parameters: Type.Object({ command: Type.String() }),
		promptGuidelines: ["Use bash for shell work."],
	},
	{
		name: "ls",
		description: "List directory contents.",
		parameters: Type.Object({ path: Type.Optional(Type.String()) }),
	},
];

describe("parseDebugToolNames", () => {
	it.each([
		{ argv: ["--debug-tools"], expected: undefined },
		{ argv: ["--debug-tools", "bash, ls"], expected: ["bash", "ls"] },
		{ argv: ["--debug-tools=bash,ls,bash"], expected: ["bash", "ls"] },
	])("parses $argv", ({ argv, expected }) => {
		expect(parseDebugToolNames(argv)).toEqual(expected);
	});

	it("rejects empty comma-separated names", () => {
		expect(() => parseDebugToolNames(["--debug-tools", "bash,,ls"])).toThrow(
			"comma-separated list of non-empty tool names",
		);
	});
});

describe("formatDebugToolReport", () => {
	it("shows every registered tool when no selector is provided", () => {
		const report = formatDebugToolReport({ tools, activeTools: ["bash"] });

		expect(report).toContain("Scope: all registered tools");
		expect(report).toContain("## `bash`");
		expect(report).toContain("## `ls`");
	});

	it("shows selected prompt contributions and provider-neutral definitions", () => {
		const report = formatDebugToolReport({
			tools,
			activeTools: ["bash"],
			requestedTools: ["bash", "ls"],
			model: { provider: "openai", id: "gpt-5.4" },
		});

		expect(report).toContain("Model: openai/gpt-5.4");
		expect(report).toContain("- `bash`\n  - Use bash for shell work.");
		expect(report).toContain('"description": "Execute a shell command."');
		expect(report).toContain('"command"');
		expect(report).toContain("## `ls`\nStatus: inactive");
		expect(report).toContain("(not present; tool is inactive)");
	});

	it("fails loudly for unknown requested tools", () => {
		expect(() =>
			formatDebugToolReport({
				tools,
				activeTools: [],
				requestedTools: ["missing"],
			}),
		).toThrow("Unknown tool: missing. Available tools: bash, ls.");
	});
});

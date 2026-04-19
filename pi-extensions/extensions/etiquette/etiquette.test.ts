import { describe, expect, it } from "vitest";
import {
	buildEtiquetteArgs,
	buildEtiquettePrompt,
	countMessageLines,
	ETIQUETTE_CHILD_MODEL,
	extractFinalAssistantTextFromPrintOutput,
	isOpusModelId,
	isSubagentRuntime,
	shouldExposeEtiquetteTool,
	shouldRunEtiquetteCompaction,
} from "./etiquette.js";

describe("isSubagentRuntime", () => {
	it("detects subagent env", () => {
		expect(isSubagentRuntime({ PI_SUBAGENT: "1" })).toBe(true);
		expect(isSubagentRuntime({ PI_SUBAGENT: " 1 " })).toBe(true);
		expect(isSubagentRuntime({ PI_SUBAGENT: "0" })).toBe(false);
		expect(isSubagentRuntime({})).toBe(false);
	});
});

describe("isOpusModelId", () => {
	it("detects opus models", () => {
		expect(isOpusModelId("claude-opus-4-7")).toBe(true);
		expect(isOpusModelId("CLAUDE-OPUS-4.6")).toBe(true);
		expect(isOpusModelId("gpt-5.4-mini")).toBe(false);
		expect(isOpusModelId(undefined)).toBe(false);
	});
});

describe("shouldExposeEtiquetteTool", () => {
	it("hides tool for subagents and opus models", () => {
		expect(shouldExposeEtiquetteTool("claude-sonnet-4-6", {})).toBe(true);
		expect(shouldExposeEtiquetteTool("claude-opus-4-7", {})).toBe(false);
		expect(shouldExposeEtiquetteTool("claude-sonnet-4-6", { PI_SUBAGENT: "1" })).toBe(false);
	});
});

describe("countMessageLines", () => {
	it("counts newline-delimited lines", () => {
		expect(countMessageLines("one line")).toBe(1);
		expect(countMessageLines("a\nb\nc")).toBe(3);
	});
});

describe("shouldRunEtiquetteCompaction", () => {
	it("only compacts messages longer than 50 lines", () => {
		const fiftyLines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
		const fiftyOneLines = Array.from({ length: 51 }, (_, i) => `line ${i + 1}`).join("\n");
		expect(shouldRunEtiquetteCompaction(fiftyLines)).toBe(false);
		expect(shouldRunEtiquetteCompaction(fiftyOneLines)).toBe(true);
	});
});

describe("buildEtiquettePrompt", () => {
	it("wraps the drafted message in explicit compaction instructions", () => {
		expect(buildEtiquettePrompt("hello")).toBe(
			[
				"Compact the following drafted user-facing message.",
				"Return only the compacted message text. No commentary, no quotes, no explanations.",
				"",
				"<message>",
				"hello",
				"</message>",
			].join("\n"),
		);
	});
});

describe("buildEtiquetteArgs", () => {
	it("builds the child pi invocation args", () => {
		expect(
			buildEtiquetteArgs("please compact this", ETIQUETTE_CHILD_MODEL, "/tmp/prompt.md"),
		).toEqual([
			"--print",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-tools",
			"--no-context-files",
			"--model",
			ETIQUETTE_CHILD_MODEL,
			"--system-prompt",
			"/tmp/prompt.md",
			[
				"Compact the following drafted user-facing message.",
				"Return only the compacted message text. No commentary, no quotes, no explanations.",
				"",
				"<message>",
				"please compact this",
				"</message>",
			].join("\n"),
		]);
	});
});

describe("extractFinalAssistantTextFromPrintOutput", () => {
	it("returns trimmed print output", () => {
		expect(extractFinalAssistantTextFromPrintOutput("\nhello\nworld\n")).toBe("hello\nworld");
	});
});

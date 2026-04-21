import { describe, expect, it } from "vitest";
import {
	buildConversationTranscript,
	extractSummaryFromResponse,
	pickTldrModel,
} from "./summary.js";

describe("buildConversationTranscript", () => {
	it("includes only user and assistant text, skipping tool calls, thinking, and tool results", () => {
		const transcript = buildConversationTranscript([
			{
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "Need a TL;DR for this session." }],
				},
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "internal" },
						{ type: "text", text: "I'll build that extension." },
						{ type: "toolCall", name: "read", arguments: { path: "foo.ts" } },
					],
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					content: [{ type: "text", text: "tool output" }],
				},
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", name: "edit", arguments: {} },
						{ type: "thinking", thinking: "more internal" },
					],
				},
			},
		]);

		expect(transcript).toBe(
			[
				"# User\n\nNeed a TL;DR for this session.",
				"# Assistant\n\nI'll build that extension.",
			].join("\n\n"),
		);
	});

	it("supports string-based user content", () => {
		const transcript = buildConversationTranscript([
			{
				type: "message",
				message: { role: "user", content: "Summarize where this landed." },
			},
		]);

		expect(transcript).toBe("# User\n\nSummarize where this landed.");
	});

	it("surfaces debug notes for malformed text blocks", () => {
		const debug: string[] = [];
		const transcript = buildConversationTranscript(
			[
				{
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", value: "missing text key" }],
					},
				},
			],
			{ onDebug: (message) => debug.push(message) },
		);

		expect(transcript).toBe("");
		expect(debug.some((line) => line.includes("malformed text block"))).toBe(true);
	});
});

describe("extractSummaryFromResponse", () => {
	it("extracts assistant text and captures error context", () => {
		const result = extractSummaryFromResponse({
			role: "assistant",
			stopReason: "error",
			errorMessage: "You have hit your ChatGPT usage limit.",
			content: [],
		});

		expect(result.summary).toBe("");
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("usage limit");
	});

	it("reports unexpected response content block shapes", () => {
		const result = extractSummaryFromResponse({
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "output_text", text: "raw provider payload" }],
		});

		expect(result.summary).toBe("");
		expect(
			result.debug.some((line) => line.includes('unexpected content block type "output_text"')),
		).toBe(true);
	});
});

describe("pickTldrModel", () => {
	it("returns the first configured match in preference order", () => {
		const available = [
			{
				provider: "openai-codex",
				id: "gpt-5.4-mini",
				reasoning: true,
			},
			{
				provider: "openai",
				id: "gpt-5.4-nano",
				reasoning: true,
			},
		];

		expect(pickTldrModel(available)).toEqual({
			model: available[1],
			thinkingLevel: "low",
		});
	});

	it("returns undefined when no configured model is available", () => {
		const available = [
			{
				provider: "openai",
				id: "gpt-5.4",
				reasoning: true,
			},
		];

		expect(pickTldrModel(available)).toBeUndefined();
	});
});

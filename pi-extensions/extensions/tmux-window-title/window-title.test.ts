import { describe, expect, it } from "vitest";
import {
	buildWindowTitlePrompt,
	extractFirstUserMessage,
	normalizeWindowTitle,
	parseTmuxWindowId,
	pickWindowTitleModel,
} from "./window-title.js";

describe("extractFirstUserMessage", () => {
	it("returns the first user text message from a mixed branch", () => {
		const firstMessage = extractFirstUserMessage([
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "How can I help?" }],
				},
			},
			{
				type: "message",
				message: {
					role: "user",
					content: [
						{ type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } },
						{ type: "text", text: "Build a tmux title extension." },
					],
				},
			},
			{
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "A later follow-up." }],
				},
			},
		]);

		expect(firstMessage).toBe("Build a tmux title extension.");
	});

	it("supports string-based user content", () => {
		expect(
			extractFirstUserMessage([
				{
					type: "message",
					message: { role: "user", content: "Make the title short and terse." },
				},
			]),
		).toBe("Make the title short and terse.");
	});

	it("surfaces debug notes for malformed text blocks", () => {
		const debug: string[] = [];
		const firstMessage = extractFirstUserMessage(
			[
				{
					type: "message",
					message: {
						role: "user",
						content: [{ type: "text", value: "missing text key" }],
					},
				},
			],
			{ onDebug: (message) => debug.push(message) },
		);

		expect(firstMessage).toBe("");
		expect(debug.some((line) => line.includes("malformed text block"))).toBe(true);
	});
});

describe("pickWindowTitleModel", () => {
	it("prefers gpt-5.4-nano with thinking off", () => {
		const available = [
			{ provider: "openai-codex", id: "gpt-5.4-mini", reasoning: true },
			{ provider: "openai", id: "gpt-5.4-nano", reasoning: true },
		];

		expect(pickWindowTitleModel(available)).toEqual({
			model: available[1],
			thinkingLevel: "off",
		});
	});
});

describe("normalizeWindowTitle", () => {
	it("kebab-cases the title and strips punctuation", () => {
		expect(normalizeWindowTitle("TMUX Pi extension!!!")).toBe("tmux-pi-extension");
	});

	it("limits the title to four words", () => {
		expect(normalizeWindowTitle("please build a pi extension for tmux titles")).toBe(
			"please-build-a-pi",
		);
	});

	it("falls back when the model returns unusable text", () => {
		expect(normalizeWindowTitle("```\n```", { fallback: "pi-session" })).toBe("pi-session");
	});
});

describe("parseTmuxWindowId", () => {
	it("accepts a valid tmux window id", () => {
		expect(parseTmuxWindowId("@17\n")).toBe("@17");
	});

	it("rejects invalid tmux window id output", () => {
		expect(parseTmuxWindowId("not-a-window")).toBeUndefined();
	});
});

describe("buildWindowTitlePrompt", () => {
	it("wraps the request in a structured prompt", () => {
		const prompt = buildWindowTitlePrompt("Need a concise name for this task.");
		expect(prompt).toContain("<request>");
		expect(prompt).toContain("Need a concise name for this task.");
		expect(prompt).toContain("</request>");
	});
});

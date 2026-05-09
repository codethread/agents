import { describe, expect, it } from "vitest";
import type { Message } from "@mariozechner/pi-ai";
import { getFinalOutput, getParentVisibleResultText } from "./render.js";

const makeAssistant = (
	content: Extract<Message, { role: "assistant" }>["content"],
): Extract<Message, { role: "assistant" }> => ({
	role: "assistant",
	content,
	api: "openai-responses",
	provider: "openai",
	model: "gpt-5.4",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: Date.now(),
});

const makeToolResult = (
	text: string,
	options: { isError?: boolean; toolName?: string } = {},
): Extract<Message, { role: "toolResult" }> => ({
	role: "toolResult",
	toolCallId: "call_1",
	toolName: options.toolName ?? "bash",
	content: [{ type: "text", text }],
	isError: options.isError ?? false,
	timestamp: Date.now(),
});

function makeSingleResult(options: {
	agent: string;
	messages?: Message[];
	exitCode?: number;
	stderr?: string;
	errorMessage?: string;
	stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
	sessionId?: string;
}) {
	return {
		agent: options.agent,
		agentSource: "package" as const,
		task: `Task for ${options.agent}`,
		exitCode: options.exitCode ?? 0,
		messages: options.messages ?? [],
		stderr: options.stderr ?? "",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		},
		stopReason: options.stopReason,
		errorMessage: options.errorMessage,
		sessionId: options.sessionId,
	};
}

describe("getFinalOutput", () => {
	it("returns the last assistant text when the child finished with an assistant message", () => {
		expect(
			getFinalOutput([
				makeAssistant([{ type: "text", text: "Earlier" }]),
				makeAssistant([
					{ type: "thinking", thinking: "hidden" },
					{ type: "text", text: "Final" },
					{ type: "text", text: " output" },
				]),
			]),
		).toBe("Final output");
	});

	it("returns the final tool-result text when the child ends on a tool result", () => {
		expect(
			getFinalOutput([
				makeAssistant([
					{
						type: "toolCall",
						id: "call_1",
						name: "bash",
						arguments: { command: "echo done" },
					},
				]),
				makeToolResult("done\nwith details"),
			]),
		).toBe("done\nwith details");
	});

	it("falls back to the most recent displayable text when the last message has no text", () => {
		expect(
			getFinalOutput([
				makeAssistant([{ type: "text", text: "usable output" }]),
				makeAssistant([
					{
						type: "toolCall",
						id: "call_2",
						name: "read",
						arguments: { path: "README.md" },
					},
				]),
			]),
		).toBe("usable output");
	});
});

describe("parent-visible result text", () => {
	it("returns the full child output for parent-visible results", () => {
		const scoutOutput = [
			"alpha.ts",
			"beta.ts",
			"gamma.ts",
			"delta.ts",
			"epsilon.ts",
			"zeta.ts",
		].join("\n");

		expect(
			getParentVisibleResultText(
				makeSingleResult({
					agent: "scout",
					messages: [makeAssistant([{ type: "text", text: scoutOutput }])],
				}),
			),
		).toBe(scoutOutput);
	});

	it("uses full error text for failed child runs", () => {
		expect(
			getParentVisibleResultText(
				makeSingleResult({
					agent: "hack",
					exitCode: 1,
					stderr: "first line\nsecond line\nthird line",
				}),
			),
		).toBe("first line\nsecond line\nthird line");
	});

	it("appends the resume ID XML tag when a persisted subagent session exists", () => {
		expect(
			getParentVisibleResultText(
				makeSingleResult({
					agent: "review",
					messages: [makeAssistant([{ type: "text", text: "Review findings" }])],
					sessionId: "subagent-session-123",
				}),
			),
		).toBe(
			[
				"Subagent resume ID: subagent-session-123",
				'To ask this same subagent a follow-up, call subagent with resume: "subagent-session-123".',
				"<subagent-resume-id>subagent-session-123</subagent-resume-id>",
				"",
				"Review findings",
			].join("\n"),
		);
	});
});

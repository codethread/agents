import type { Text } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import type { Message } from "@mariozechner/pi-ai";
import {
	getFinalOutput,
	getParentVisibleResultText,
	renderSubagentCall,
	renderSubagentResult,
} from "./render.js";
import { RUNNING_EXIT_CODE } from "./types.js";

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
	resumed?: boolean;
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
		resumed: options.resumed ?? false,
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

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

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

describe("renderSubagentCall", () => {
	it("labels fresh calls clearly", () => {
		const component = renderSubagentCall(
			{ agent: "scout", task: "Map auth flow without resume" },
			theme,
		) as Text;

		expect(component.render(120).join("\n")).toContain("subagent scout (fresh)");
	});

	it("labels resumed calls clearly", () => {
		const component = renderSubagentCall(
			{ agent: "scout", task: "Follow up", resume: "12345678-1234-1234-1234-123456789abc" },
			theme,
		) as Text;

		expect(component.render(120).join("\n")).toContain("subagent scout (resumed)");
	});
});

describe("renderSubagentResult", () => {
	it("renders expanded successful results with a minimal header and no nested summary block", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							resumed: true,
							messages: [makeAssistant([{ type: "text", text: "## Findings\n\n- done" }])],
						}),
					],
				},
			},
			{ expanded: true },
			theme,
		) as any;

		expect(component.children).toHaveLength(3);
		expect(component.children[0].render(120).join("\n")).toContain("✓ subagent scout (resumed)");
	});

	it("shows no success tick while the subagent is still running", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "running" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							exitCode: RUNNING_EXIT_CODE,
						}),
					],
				},
			},
			{ expanded: false },
			theme,
		) as Text;

		const output = component.render(120).join("\n");
		expect(output).toContain("subagent scout (fresh) running");
		expect(output).not.toContain("✓");
	});

	it("shows a success tick once the subagent completes", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							messages: [makeAssistant([{ type: "text", text: "done" }])],
						}),
					],
				},
			},
			{ expanded: false },
			theme,
		) as Text;

		expect(component.render(120).join("\n")).toContain("✓ subagent scout (fresh)");
	});

	it("shows resumed status once a resumed subagent completes", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							resumed: true,
							messages: [makeAssistant([{ type: "text", text: "done" }])],
						}),
					],
				},
			},
			{ expanded: false },
			theme,
		) as Text;

		expect(component.render(120).join("\n")).toContain("✓ subagent scout (resumed)");
	});
});

import type { Container, Text } from "@earendil-works/pi-tui";
import { Markdown } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import {
	getFinalOutput,
	getParentVisibleResultText,
	getParentVisibleSwarmResultText,
	formatAttemptSummary,
	renderSubagentCall,
	renderSubagentResult,
	formatDebugSwarmSection,
	formatSwarmResults,
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
	provider?: string;
	model?: string;
	thinkingLevel?: string;
	attempts?: {
		attemptedModel: string;
		attempt: number;
		success: boolean;
		exitCode?: number;
		error?: string;
		retryable?: boolean;
	}[];
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
		provider: options.provider,
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		attempts: options.attempts,
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

describe("formatDebugSwarmSection", () => {
	it("includes source, file path, hidden marker, and members", () => {
		expect(
			formatDebugSwarmSection("Available swarms:", [
				{
					name: "review",
					description: "Run parallel checks",
					source: "user",
					hidden: false,
					members: ["alpha", "beta"],
					filePath: "/tmp/.pi/swarms/review/swarm.json",
				},
				{
					name: "hidden-review",
					description: "Internal",
					source: "project",
					hidden: true,
					members: ["gamma"],
					filePath: "/tmp/.pi/swarms/hidden/swarm.json",
				},
			]),
		).toBe(
			[
				"Available swarms:",
				"- review [user]",
				"  file: /tmp/.pi/swarms/review/swarm.json",
				"  members: alpha, beta",
				"- hidden-review [project] (hidden from prompt inventory)",
				"  file: /tmp/.pi/swarms/hidden/swarm.json",
				"  members: gamma",
			].join("\n"),
		);
	});

	it("renders as none when no swarms are provided", () => {
		expect(formatDebugSwarmSection("Available swarms:", [])).toBe(
			["Available swarms:", "(none)"].join("\n"),
		);
	});
});

describe("formatSwarmResults", () => {
	it("renders one multiline <member> block per result with escaped names and status", () => {
		expect(
			formatSwarmResults([
				makeSingleResult({
					agent: "scout & review",
					messages: [makeAssistant([{ type: "text", text: "Scout done" }])],
				}),
				makeSingleResult({
					agent: "hack",
					exitCode: 1,
					errorMessage: "Hack failed",
				}),
			]),
		).toBe(
			[
				'<member name="scout &amp; review" status="ok"><![CDATA[',
				"Scout done",
				"]]></member>",
				"",
				'<member name="hack" status="error"><![CDATA[',
				"Hack failed",
				"]]></member>",
			].join("\n"),
		);
	});

	it("splits embedded ]]>'s safely for CDATA", () => {
		expect(
			formatSwarmResults([
				makeSingleResult({
					agent: "xml-happy",
					messages: [
						makeAssistant([{ type: "text", text: "prefix </member> end and ]]> then more" }]),
					],
				}),
			]),
		).toBe(
			[
				'<member name="xml-happy" status="ok"><![CDATA[',
				"prefix </member> end and ]]]]><![CDATA[> then more",
				"]]></member>",
			].join("\n"),
		);
	});

	it("includes resume attribute when a swarm member resumed", () => {
		expect(
			formatSwarmResults([
				makeSingleResult({
					agent: 'core"agent',
					resumed: true,
					messages: [],
				}),
			]),
		).toBe(
			[
				'<member name="core&quot;agent" status="ok" resume="true"><![CDATA[',
				"(no output)",
				"]]></member>",
			].join("\n"),
		);
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

	it("keeps successful attempt metadata out of parent-visible results", () => {
		expect(
			getParentVisibleResultText(
				makeSingleResult({
					agent: "scout",
					messages: [makeAssistant([{ type: "text", text: "Scout done" }])],
					attempts: [
						{
							attemptedModel: "provider/a",
							attempt: 1,
							success: false,
							exitCode: 1,
							error: "model unavailable",
							retryable: false,
						},
						{ attemptedModel: "provider/b", attempt: 1, success: true, exitCode: 0 },
					],
				}),
			),
		).toBe("Scout done");
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

	it("adds one friendly swarm resume ID above swarm member blocks", () => {
		expect(
			getParentVisibleSwarmResultText(
				[
					makeSingleResult({
						agent: "scout",
						messages: [makeAssistant([{ type: "text", text: "Scout done" }])],
					}),
					makeSingleResult({
						agent: "hack",
						exitCode: 1,
						errorMessage: "Hack failed",
					}),
				],
				"swarm-review-abc",
			),
		).toBe(
			[
				"Subagent resume ID: swarm-review-abc",
				'To ask this same swarm a follow-up, call subagent with resume: "swarm-review-abc".',
				"<subagent-resume-id>swarm-review-abc</subagent-resume-id>",
				"",
				[
					'<member name="scout" status="ok"><![CDATA[',
					"Scout done",
					"]]></member>",
					"",
					'<member name="hack" status="error"><![CDATA[',
					"Hack failed",
					"]]></member>",
				].join("\n"),
			].join("\n"),
		);
	});
});

describe("renderSubagentCall", () => {
	it("renders no separate call line so the result owns the subagent header", () => {
		const component = renderSubagentCall(
			{ agent: "scout", task: "Map auth flow without resume" },
			theme,
		) as Text;

		expect(component.render(120).join("\n")).toBe("");
	});
});

describe("formatAttemptSummary", () => {
	it("summarizes final model and failed attempt count", () => {
		expect(
			formatAttemptSummary(
				makeSingleResult({
					agent: "scout",
					attempts: [
						{
							attemptedModel: "provider/first-model",
							attempt: 1,
							success: false,
							exitCode: 1,
							error: "model not found",
							retryable: false,
						},
						{ attemptedModel: "provider/final-model", attempt: 1, success: true, exitCode: 0 },
					],
				}),
			),
		).toBe("model-chain final-model; 1 failed");
	});
});

describe("renderSubagentResult", () => {
	it("renders expanded results with session id, prompt, and final markdown output", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							resumed: true,
							sessionId: "session-123",
							messages: [makeAssistant([{ type: "text", text: "## Findings\n\n- done" }])],
						}),
					],
				},
			},
			{ expanded: true },
			theme,
		) as unknown as Container;
		const singleResult = component.children[0] as Container;

		expect(singleResult.children[0].render(120).join("\n")).toContain(
			"subagent scout [session-123] (resumed)",
		);
		expect(singleResult.children[2].render(120).join("\n")).toContain("Task for scout");
		expect(singleResult.children[4]).toBeInstanceOf(Markdown);
	});

	it("shows running state while the subagent is still running", () => {
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
		expect(output).toContain("subagent scout [pending-session] (fresh)");
		expect(output).toContain("(running...)");
		expect(output).toContain("(Ctrl+O to expand)");
	});

	it("renders collapsed single-result output with header, model, thinking, and session id", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							sessionId: "session-123",
							provider: "openai",
							model: "gpt-5.5",
							thinkingLevel: "low",
							messages: [makeAssistant([{ type: "text", text: "done" }])],
						}),
					],
				},
			},
			{ expanded: false },
			theme,
		) as Text;

		const output = component.render(120).join("\n");
		expect(output).toContain("subagent scout gpt-5.5:low [session-123] (fresh)");
		expect(output).toContain("> Task for scout");
		expect(output).not.toContain("openai");
		expect(output).toContain("done");
		expect(output).toContain("(Ctrl+O to expand)");
	});

	it("hides the session id in narrow collapsed headers", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "council-scope-guard",
							sessionId: "019e12db-c557-70eb-94a3-26b2deb6ba73",
							provider: "openai",
							model: "gpt-5.5",
							thinkingLevel: "low",
							messages: [makeAssistant([{ type: "text", text: "done" }])],
						}),
					],
				},
			},
			{ expanded: false },
			theme,
		) as Text;

		const output = component.render(60).join("\n");
		expect(output).toContain("subagent council-scope-guard gpt-5.5:low (fresh)");
		expect(output).toContain("> Task for council-scope-guard");
		expect(output).not.toContain("019e12db");
	});

	it("renders compact model-chain metadata in collapsed view", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							messages: [makeAssistant([{ type: "text", text: "done" }])],
							attempts: [
								{
									attemptedModel: "provider/a",
									attempt: 1,
									success: false,
									exitCode: 1,
									error: "provider unavailable",
									retryable: true,
								},
								{ attemptedModel: "provider/b", attempt: 1, success: true, exitCode: 0 },
							],
						}),
					],
				},
			},
			{ expanded: false },
			theme,
		) as Text;

		const output = component.render(120).join("\n");
		expect(output).toContain("model-chain b; 1 failed");
		expect(output).toContain("done");
	});

	it("renders compact model-chain metadata in expanded view", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							messages: [makeAssistant([{ type: "text", text: "done" }])],
							attempts: [
								{
									attemptedModel: "provider/a",
									attempt: 1,
									success: false,
									exitCode: 1,
									error: "provider unavailable",
									retryable: true,
								},
								{ attemptedModel: "provider/b", attempt: 1, success: true, exitCode: 0 },
							],
						}),
					],
				},
			},
			{ expanded: true },
			theme,
		) as unknown as Container;
		const singleResult = component.children[0] as Container;

		expect(singleResult.children.at(-1)?.render(120).join("\n")).toContain(
			"model-chain b; 1 failed",
		);
	});

	it("renders all swarm members in collapsed view", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							sessionId: "session-scout",
							messages: [makeAssistant([{ type: "text", text: "scout output" }])],
						}),
						makeSingleResult({
							agent: "hack",
							exitCode: 1,
							errorMessage: "hack failed",
						}),
					],
				},
			},
			{ expanded: false },
			theme,
		) as Text;

		const output = component.render(120).join("\n");
		expect(output).toContain("subagent scout (fresh)");
		expect(output).toContain("> Task for scout");
		expect(output).toContain("scout                    ✓ [session-scout]");
		expect(output).toContain("hack                     x [no-session]");
		expect(output).toContain("x: hack failed");
	});

	it("renders all swarm members in expanded view", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							sessionId: "session-scout",
							messages: [makeAssistant([{ type: "text", text: "scout output" }])],
						}),
						makeSingleResult({
							agent: "security-review",
							sessionId: "session-security",
							messages: [makeAssistant([{ type: "text", text: "security output" }])],
						}),
					],
				},
			},
			{ expanded: true },
			theme,
		) as Text;

		const output = component.render(120).join("\n");
		expect(output).toContain("subagent scout (fresh)");
		expect(output).toContain("> Task for scout");
		expect(output).toContain("scout                    ✓ [session-scout]");
		expect(output).toContain("security-review          ✓ [session-security]");
	});

	it("keeps expanded activity collapsed to the latest three items", () => {
		const component = renderSubagentResult(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					results: [
						makeSingleResult({
							agent: "scout",
							exitCode: RUNNING_EXIT_CODE,
							messages: [
								makeAssistant([
									{ type: "text", text: "one" },
									{ type: "text", text: "two" },
									{ type: "text", text: "three" },
									{ type: "text", text: "four" },
								]),
							],
						}),
					],
				},
			},
			{ expanded: true },
			theme,
		) as unknown as Container;
		const singleResult = component.children[0] as Container;
		const output = singleResult.children[4].render(120).join("\n");
		expect(output).toContain("... 1 earlier items");
		expect(output).toContain("two");
		expect(output).toContain("three");
		expect(output).toContain("four");
		expect(output).not.toContain("one");
	});
});

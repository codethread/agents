import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const buildPrompt = vi.fn(() => "<owned prompt />");
	const renderDynamicPrompt = vi.fn(async () => "<dynamic />");
	const showDebugMessage = vi.fn(async () => {});

	return {
		buildPrompt,
		renderDynamicPrompt,
		showDebugMessage,
	};
});

vi.mock("../components/debug-message/index.js", () => ({
	showDebugMessage: mocks.showDebugMessage,
}));

vi.mock("./prompt-builder.js", () => ({
	DEFAULT_IDENTITY:
		"You are an expert coding assistant operating inside pi, a coding agent harness.",
	buildSystemPrompt: mocks.buildPrompt,
}));

vi.mock("./templates.js", () => ({
	parseDebugPromptOverrides: vi.fn(() => ({ overrides: null, error: null })),
	renderDynamicPrompt: mocks.renderDynamicPrompt,
}));

import systemPromptExtension from "./index.js";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.buildPrompt.mockReturnValue("<owned prompt />");
	mocks.renderDynamicPrompt.mockResolvedValue("<dynamic />");
});

describe("system-prompt extension", () => {
	it("registers one handler per Pi event on the merged entrypoint", () => {
		const on = vi.fn();
		const registerFlag = vi.fn();
		const registerCommand = vi.fn();
		const getFlag = vi.fn(() => false);
		const getActiveTools = vi.fn(() => ["read", "bash", "edit", "write"]);
		const sendUserMessage = vi.fn();
		const exec = vi.fn();

		systemPromptExtension({
			on,
			registerFlag,
			registerCommand,
			registerTool: vi.fn(),
			getFlag,
			getActiveTools,
			sendUserMessage,
			exec,
		} as any);

		expect(registerFlag).toHaveBeenCalledTimes(1);
		expect(registerFlag).toHaveBeenCalledWith(
			"debug-prompt",
			expect.objectContaining({ type: "boolean", default: false }),
		);
		expect(registerCommand).toHaveBeenCalledWith(
			"debug-prompt",
			expect.objectContaining({ description: expect.any(String), handler: expect.any(Function) }),
		);
		expect(registerCommand).toHaveBeenCalledTimes(1);

		const counts = new Map<string, number>();
		for (const [eventName] of on.mock.calls) {
			counts.set(eventName, (counts.get(eventName) ?? 0) + 1);
		}

		expect(counts.get("session_start")).toBe(1);
		expect(counts.get("before_agent_start")).toBe(1);
		expect(counts.get("agent_start")).toBe(1);
		expect(counts.has("input")).toBe(false);
	});

	it("arms --debug-prompt without sending a synthetic ping", () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const sendUserMessage = vi.fn();
		const notify = vi.fn();

		systemPromptExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn((name: string) => name === "debug-prompt"),
			getActiveTools: vi.fn(() => ["read"]),
			sendUserMessage,
			exec: vi.fn(),
		} as any);

		handlers.get("session_start")?.({}, { cwd: "/repo", hasUI: true, ui: { notify } });

		expect(sendUserMessage).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(
			"Debug prompt mode: send a message to materialize the prompt.",
			"info",
		);
	});

	it("composes owned and dynamic prompt sections in order", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const getActiveTools = vi.fn(() => ["write"]);

		systemPromptExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools,
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);

		const result = await handlers.get("before_agent_start")?.(
			{
				systemPrompt: "Base prompt",
				systemPromptOptions: {
					cwd: "/repo",
					selectedTools: ["bash", "edit"],
					toolSnippets: { bash: "Run shell commands", edit: "Edit files" },
					promptGuidelines: ["Use edit for precise changes."],
					contextFiles: [{ path: "/repo/AGENTS.md", content: "rules" }],
					skills: [{ name: "test", description: "desc", filePath: "/skill.md" }],
					appendSystemPrompt: "extra",
				},
			},
			{
				cwd: "/repo",
				hasUI: true,
				model: { provider: "openai", id: "gpt-5" },
			},
		);

		expect(getActiveTools).not.toHaveBeenCalled();
		expect(mocks.buildPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/repo",
				selectedTools: ["bash", "edit"],
				toolSnippets: { bash: "Run shell commands", edit: "Edit files" },
				promptGuidelines: ["Use edit for precise changes."],
				contextFiles: [{ path: "/repo/AGENTS.md", content: "rules" }],
				skills: [{ name: "test", description: "desc", filePath: "/skill.md" }],
				appendSystemPrompt: "extra",
				dynamicPrompt: "<dynamic />",
			}),
		);
		expect(mocks.renderDynamicPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/repo",
				hasUI: true,
				model: { provider: "openai", id: "gpt-5" },
				tools: ["bash", "edit"],
			}),
			null,
		);
		expect(result).toEqual({
			systemPrompt: "<owned prompt />",
		});
	});

	it("warns when /debug-prompt is used before the first materialized turn", async () => {
		const registerCommand = vi.fn();
		const notify = vi.fn();

		systemPromptExtension({
			on: vi.fn(),
			registerFlag: vi.fn(),
			registerCommand,
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => ["read"]),
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);

		const [, command] = registerCommand.mock.calls.find(([name]) => name === "debug-prompt")!;
		await command.handler("", { hasUI: true, ui: { notify } });

		expect(notify).toHaveBeenCalledWith(
			"No materialized system prompt yet. Send a message first, then rerun /debug-prompt.",
			"warning",
		);
		expect(mocks.showDebugMessage).not.toHaveBeenCalled();
	});

	it("shows the last materialized prompt for /debug-prompt", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const registerCommand = vi.fn();
		const sendUserMessage = vi.fn();

		systemPromptExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand,
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => ["read"]),
			sendUserMessage,
			exec: vi.fn(),
		} as any);

		await handlers.get("agent_start")?.({}, { getSystemPrompt: () => "Base\n\n<owned />" });

		const [, command] = registerCommand.mock.calls.find(([name]) => name === "debug-prompt")!;
		await command.handler("", { hasUI: true, ui: {} });

		expect(mocks.showDebugMessage).toHaveBeenCalledWith(
			expect.objectContaining({ hasUI: true }),
			expect.objectContaining({
				headingText: "Debug Prompt",
				subheadingText: "last materialized effective prompt",
				markdownBody: expect.stringContaining("Base\n\n<owned />"),
				sendMarkdownToAgent: expect.any(Function),
			}),
		);

		const showDebugCalls = mocks.showDebugMessage.mock.calls as unknown[][];
		const props = showDebugCalls[0]?.[1] as
			| { sendMarkdownToAgent: () => Promise<void> }
			| undefined;
		expect(props).toBeDefined();
		await props?.sendMarkdownToAgent();
		expect(sendUserMessage).toHaveBeenCalledWith("Base\n\n<owned />");
	});
});

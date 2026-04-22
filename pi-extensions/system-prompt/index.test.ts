import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const buildOwnedPromptAddon = vi.fn(() => "<owned />");
	const shouldAppendOwnedPrompt = vi.fn(() => true);
	const renderDynamicAgentsPrompt = vi.fn(async () => "<dynamic />");
	const showDebugMessage = vi.fn(async () => {});
	const projectStructureController = {
		reset: vi.fn(),
		invalidate: vi.fn(),
		prime: vi.fn(),
		getPrompt: vi.fn(async () => "<structure />"),
	};

	return {
		buildOwnedPromptAddon,
		shouldAppendOwnedPrompt,
		renderDynamicAgentsPrompt,
		showDebugMessage,
		projectStructureController,
	};
});

vi.mock("../components/debug-message/index.js", () => ({
	showDebugMessage: mocks.showDebugMessage,
}));

vi.mock("./owned-system-prompt/index.js", () => ({
	buildOwnedPromptAddon: mocks.buildOwnedPromptAddon,
	shouldAppendOwnedPrompt: mocks.shouldAppendOwnedPrompt,
}));

vi.mock("./dynamic-agents-md/index.js", () => ({
	parseDebugPromptOverrides: vi.fn(() => ({ overrides: null, error: null })),
	renderDynamicAgentsPrompt: mocks.renderDynamicAgentsPrompt,
}));

vi.mock("./project-structure-prompt/index.js", () => ({
	INVALIDATING_TOOLS: new Set(["bash", "write"]),
	createProjectStructurePromptController: vi.fn(() => mocks.projectStructureController),
}));

import systemPromptExtension from "./index.js";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.buildOwnedPromptAddon.mockReturnValue("<owned />");
	mocks.shouldAppendOwnedPrompt.mockReturnValue(true);
	mocks.renderDynamicAgentsPrompt.mockResolvedValue("<dynamic />");
	mocks.projectStructureController.getPrompt.mockResolvedValue("<structure />");
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
		expect(counts.get("tool_execution_end")).toBe(1);
		expect(counts.has("input")).toBe(false);
	});

	it("queues one synthetic ping turn for --debug-prompt", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const sendUserMessage = vi.fn();
		const notify = vi.fn();

		systemPromptExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			getFlag: vi.fn((name: string) => name === "debug-prompt"),
			getActiveTools: vi.fn(() => ["read"]),
			sendUserMessage,
			exec: vi.fn(),
		} as any);

		await handlers.get("session_start")?.({}, { cwd: "/repo", hasUI: true, ui: { notify } });

		expect(mocks.projectStructureController.reset).toHaveBeenCalled();
		expect(mocks.projectStructureController.prime).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: "/repo" }),
		);
		expect(sendUserMessage).toHaveBeenCalledWith("ping");
		expect(notify).toHaveBeenCalledWith(
			"Debug prompt mode: starting a ping turn to materialize the prompt.",
			"info",
		);
	});

	it("composes owned, dynamic, and project-structure prompt sections in order", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const getActiveTools = vi.fn(() => ["write"]);

		systemPromptExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools,
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);

		const result = await handlers.get("before_agent_start")?.(
			{
				systemPrompt: "Base prompt",
				systemPromptOptions: {
					selectedTools: ["bash", "edit"],
				},
			},
			{
				cwd: "/repo",
				hasUI: true,
				model: { provider: "openai", id: "gpt-5" },
			},
		);

		expect(getActiveTools).not.toHaveBeenCalled();
		expect(mocks.buildOwnedPromptAddon).toHaveBeenCalledWith(["bash", "edit"]);
		expect(mocks.renderDynamicAgentsPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/repo",
				hasUI: true,
				model: { provider: "openai", id: "gpt-5" },
				tools: ["bash", "edit"],
			}),
			null,
		);
		expect(mocks.projectStructureController.getPrompt).toHaveBeenCalled();
		expect(result).toEqual({
			systemPrompt: "Base prompt\n\n<owned />\n\n<dynamic />\n\n<structure />",
		});
	});

	it("warns when /debug-prompt is used before the first materialized turn", async () => {
		const registerCommand = vi.fn();
		const notify = vi.fn();

		systemPromptExtension({
			on: vi.fn(),
			registerFlag: vi.fn(),
			registerCommand,
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

	it("invalidates the project structure cache after bash/write tool executions", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();

		systemPromptExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => ["read"]),
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);

		await handlers.get("tool_execution_end")?.({ toolName: "bash" }, {} as any);
		await handlers.get("tool_execution_end")?.({ toolName: "read" }, {} as any);

		expect(mocks.projectStructureController.invalidate).toHaveBeenCalledTimes(1);
	});
});

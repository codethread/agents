import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptInput } from "./prompt-builder.js";

const mocks = vi.hoisted(() => ({
	buildPrompt: vi.fn((_input: PromptInput) => ({
		preamble: "Default persona",
		tools: "<owned prompt />",
	})),
	loadClaudeLocalContextFiles: vi.fn(async () => []),
	renderDynamicPrompt: vi.fn(async () => "<dynamic />"),
	showDebugMessage: vi.fn(async (..._args: any[]) => {}),
}));

vi.mock("../components/debug-message/index.js", () => ({
	showDebugMessage: mocks.showDebugMessage,
}));
vi.mock("./prompt-builder.js", () => ({
	DEFAULT_PERSONA: "Default persona",
	buildSystemPromptSections: mocks.buildPrompt,
	loadClaudeLocalContextFiles: mocks.loadClaudeLocalContextFiles,
}));
vi.mock("./templates.js", () => ({
	parseDebugPromptOverrides: () => ({ overrides: null, error: null }),
	renderDynamicPrompt: mocks.renderDynamicPrompt,
}));

import systemPromptExtension from "./index.js";

function setup(flags: string[] = []) {
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const pi = {
		on: (name: string, handler: (event: any, ctx: any) => any) => handlers.set(name, handler),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerFlag: vi.fn(),
		registerTool: vi.fn(),
		getFlag: (name: string) => flags.includes(name),
		getActiveTools: vi.fn(() => ["read"]),
		sendUserMessage: vi.fn(),
		exec: vi.fn(),
	};
	const ctx = {
		cwd: "/repo",
		hasUI: true,
		model: null,
		ui: { notify: vi.fn() },
		getSystemPrompt: () => "Base\n\n<owned />",
	};
	systemPromptExtension(pi as any);
	return { pi, ctx, handlers, commands };
}

function promptEvent() {
	return {
		type: "before_agent_start",
		messageType: "user",
		prompt: "test",
		systemPrompt: "base prompt",
		systemPromptOptions: {
			cwd: "/repo",
			selectedTools: ["bash", "edit"],
			toolSnippets: { bash: "Run shell commands", edit: "Edit files" },
			promptGuidelines: ["Use edit for precise changes."],
			contextFiles: [{ path: "/repo/AGENTS.md", content: "rules" }],
			skills: [],
			appendSystemPrompt: "ordinary launch guidance",
			sections: {} as Record<string, string>,
		},
	};
}

let event = promptEvent();

beforeEach(() => {
	event = promptEvent();
	vi.clearAllMocks();
	mocks.renderDynamicPrompt.mockResolvedValue("<dynamic />");
});

describe("system-prompt extension", () => {
	it.each(["user", "custom"] as const)(
		"renders the owned prompt for %s runs",
		async (messageType) => {
			const { ctx, handlers } = setup();
			await handlers.get("session_start")!({}, ctx);
			const { prompt: _prompt, ...sharedEvent } = event;
			const startingEvent =
				messageType === "user"
					? event
					: {
							...sharedEvent,
							messageType,
							message: { customType: "continue", content: "Continue work", display: false },
						};
			expect(await handlers.get("before_agent_start")!(startingEvent, ctx)).toBeUndefined();
			expect(startingEvent.systemPromptOptions.sections.tools).toBe("<owned prompt />");
			expect(mocks.buildPrompt).toHaveBeenCalledWith(
				expect.objectContaining({
					cwd: "/repo",
					contextFiles: event.systemPromptOptions.contextFiles,
					appendSystemPrompt: "ordinary launch guidance",
					dynamicPrompt: "<dynamic />",
				}),
			);
		},
	);

	it("renders templates once per lifecycle, not on every turn", async () => {
		const { ctx, handlers } = setup();
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("before_agent_start")!(event, ctx);
		await handlers.get("before_agent_start")!(event, ctx);
		expect(mocks.renderDynamicPrompt).toHaveBeenCalledTimes(1);
		await handlers.get("session_start")!({ reason: "reload" }, ctx);
		expect(mocks.renderDynamicPrompt).toHaveBeenCalledTimes(2);
	});

	it("arms --debug-prompt without sending a synthetic ping", async () => {
		const { pi, ctx, handlers } = setup(["debug-prompt"]);
		await handlers.get("session_start")!({}, ctx);
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Debug prompt mode: send a message to materialize the prompt.",
			"info",
		);
	});

	it("warns before a materialized prompt and then shows the actual final prompt", async () => {
		const { pi, ctx, handlers, commands } = setup();
		await commands.get("debug-prompt")!.handler("", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"No materialized system prompt yet. Send a message first, then rerun /debug-prompt.",
			"warning",
		);
		expect(mocks.showDebugMessage).not.toHaveBeenCalled();
		handlers.get("agent_start")!({}, ctx);
		await commands.get("debug-prompt")!.handler("", ctx);
		const props = mocks.showDebugMessage.mock.calls[0][1];
		expect(props.markdownBody).toBe("Base\n\n<owned />");
		await props.sendMarkdownToAgent();
		expect(pi.sendUserMessage).toHaveBeenCalledWith("Base\n\n<owned />");
	});
});

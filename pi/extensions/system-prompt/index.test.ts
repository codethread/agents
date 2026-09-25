import type * as MillstrandIdentity from "@millhouse/harnesses/pi/millstrand-identity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptInput } from "./prompt-builder.js";

const mocks = vi.hoisted(() => ({
	buildPrompt: vi.fn((_input: PromptInput) => "<owned prompt />"),
	loadClaudeLocalContextFiles: vi.fn(async () => []),
	renderDynamicPrompt: vi.fn(async () => "<dynamic />"),
	showDebugMessage: vi.fn(async (..._args: any[]) => {}),
	resolveNativeIdentity: vi.fn<typeof MillstrandIdentity.resolveNativeIdentity>(),
}));

vi.mock("@millhouse/harnesses/pi/millstrand-identity", async (importOriginal) => ({
	...(await importOriginal<typeof MillstrandIdentity>()),
	resolveNativeIdentity: mocks.resolveNativeIdentity,
}));
vi.mock("../components/debug-message/index.js", () => ({
	showDebugMessage: mocks.showDebugMessage,
}));
vi.mock("./prompt-builder.js", () => ({
	DEFAULT_PERSONA: "Default persona",
	buildSystemPrompt: mocks.buildPrompt,
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
		events: { emit: vi.fn() },
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
		ui: { notify: vi.fn(), setStatus: vi.fn() },
		sessionManager: { getSessionId: () => "session-1" },
		getSystemPrompt: () => "Base\n\n<owned />",
	};
	systemPromptExtension(pi as any);
	return { pi, ctx, handlers, commands };
}

const event = {
	systemPrompt: "base prompt",
	systemPromptOptions: {
		cwd: "/repo",
		selectedTools: ["bash", "edit"],
		toolSnippets: { bash: "Run shell commands", edit: "Edit files" },
		promptGuidelines: ["Use edit for precise changes."],
		contextFiles: [{ path: "/repo/AGENTS.md", content: "rules" }],
		skills: [],
		appendSystemPrompt: "ordinary launch guidance",
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.renderDynamicPrompt.mockResolvedValue("<dynamic />");
	mocks.resolveNativeIdentity.mockImplementation(async (_exec, options) => ({
		identity: "warm-silver-lemur",
		strandId: "identity-1",
		runId: "run-1",
		result: "minted",
		instruction: "Your Millstrand identity is warm-silver-lemur.",
		nativeSessionId: options.nativeSessionId,
	}));
});

describe("system-prompt extension", () => {
	it("renders the canonical identity alongside ordinary prompt sections and publishes UI status", async () => {
		const { ctx, handlers } = setup();
		await handlers.get("session_start")!({}, ctx);
		expect(await handlers.get("before_agent_start")!(event, ctx)).toEqual({
			systemPrompt: "<owned prompt />",
		});
		expect(mocks.buildPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				...event.systemPromptOptions,
				dynamicPrompt: "<dynamic />",
				millstrandIdentityInstruction: "Your Millstrand identity is warm-silver-lemur.",
			}),
		);
		expect(ctx.ui.setStatus.mock.calls).toEqual([
			["millstrand-identity", undefined],
			["millstrand-identity", "warm-silver-lemur"],
		]);
	});

	it("reads current lifecycle state instead of retaining a previous session's identity", async () => {
		const { ctx, handlers } = setup();
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("before_agent_start")!(event, ctx);
		mocks.resolveNativeIdentity.mockResolvedValueOnce(null);
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("before_agent_start")!(event, ctx);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("millstrand-identity", undefined);
		expect(mocks.buildPrompt.mock.calls.at(-1)![0].millstrandIdentityInstruction).toBeUndefined();
	});

	it("renders templates once per lifecycle, not on every turn", async () => {
		const { ctx, handlers } = setup();
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("before_agent_start")!(event, ctx);
		await handlers.get("before_agent_start")!(event, ctx);
		expect(mocks.renderDynamicPrompt).toHaveBeenCalledTimes(1);
		await handlers.get("session_start")!({ reason: "reload" }, ctx);
		expect(mocks.renderDynamicPrompt).toHaveBeenCalledTimes(2);
		expect(mocks.resolveNativeIdentity).toHaveBeenCalledTimes(2);
	});

	it("clears stale identity on lookup failure without blocking input or model work", async () => {
		const { pi, ctx, handlers, commands } = setup();
		await handlers.get("session_start")!({}, ctx);
		mocks.resolveNativeIdentity.mockRejectedValueOnce(new Error("Weaver unavailable"));
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("before_agent_start")!(event, ctx);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("millstrand-identity", undefined);
		expect(pi.events.emit).toHaveBeenLastCalledWith(
			"codethread:millstrand-identity-context:v1",
			null,
		);
		expect(mocks.buildPrompt.mock.calls.at(-1)![0].millstrandIdentityInstruction).toBeUndefined();
		expect(handlers.has("input")).toBe(false);
		expect(handlers.has("before_provider_request")).toBe(false);
		await commands.get("debug-millstrand-identity")!.handler("", ctx);
		expect(mocks.showDebugMessage.mock.calls[0][1].markdownBody).toContain("Weaver unavailable");
		handlers.get("session_shutdown")!({}, ctx);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("millstrand-identity", undefined);
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

	it("shows the current identity in the standard hidden debug panel", async () => {
		const { ctx, handlers, commands } = setup();
		await handlers.get("session_start")!({}, ctx);
		await commands.get("debug-millstrand-identity")!.handler("", ctx);
		expect(mocks.showDebugMessage).toHaveBeenCalledWith(
			ctx,
			expect.objectContaining({
				headingText: "Millstrand Identity",
				markdownBody: expect.stringContaining("warm-silver-lemur"),
			}),
		);
	});
});

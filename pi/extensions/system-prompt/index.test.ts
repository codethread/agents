import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const buildPrompt = vi.fn(() => "<owned prompt />");
	const loadClaudeLocalContextFiles = vi.fn(async () => []);
	const renderDynamicPrompt = vi.fn(async () => "<dynamic />");
	const showDebugMessage = vi.fn(async () => {});
	const selectManagedPiGuidance = vi.fn((..._args: unknown[]) => ({ kind: "unmanaged" as const }));
	const stageManagedPiGuidanceSelection = vi.fn((...args: unknown[]) => ({
		kind: "selected" as const,
		selection: selectManagedPiGuidance(...args),
	}));
	const fetchManagedGuidance = vi.fn();
	const acknowledgeManagedGuidance = vi.fn(async () => {});
	const failManagedGuidance = vi.fn(async () => {});
	const renderManagedGuidance = vi.fn(() => "<managed />");
	const formatManagedGuidanceDebug = vi.fn(() => '{"selection":"native-v1"}');
	const isLegacyManagedPiEnvironment = vi.fn(() => false);
	const resolveNativeIdentity = vi.fn(async (_exec, options) => ({
		identity: "warm-silver-lemur",
		strandId: "identity-1",
		result: "minted" as const,
		instruction: "Your Millstrand identity is warm-silver-lemur.",
		nativeSessionId: options.nativeSessionId,
	}));

	return {
		buildPrompt,
		loadClaudeLocalContextFiles,
		renderDynamicPrompt,
		showDebugMessage,
		selectManagedPiGuidance,
		stageManagedPiGuidanceSelection,
		fetchManagedGuidance,
		acknowledgeManagedGuidance,
		failManagedGuidance,
		renderManagedGuidance,
		formatManagedGuidanceDebug,
		isLegacyManagedPiEnvironment,
		resolveNativeIdentity,
	};
});

vi.mock("../components/debug-message/index.js", () => ({
	showDebugMessage: mocks.showDebugMessage,
}));

vi.mock("./native-identity.js", () => ({
	DEBUG_MILLSTRAND_IDENTITY_FLAG: "debug-millstrand-identity",
	MILLSTRAND_IDENTITY_FLAG: "millstrand-identity",
	MILLSTRAND_WORKSPACE_FLAG: "millstrand-workspace",
	formatNativeIdentityState: vi.fn(() => "{}"),
	getNativeIdentityInputs: vi.fn(() => ({})),
	isLegacyManagedPiEnvironment: mocks.isLegacyManagedPiEnvironment,
	nativeIdentityModel: vi.fn((ctx) => ctx.model?.id),
	resolveNativeIdentity: mocks.resolveNativeIdentity,
}));

vi.mock("./managed-guidance.js", () => ({
	ManagedGuidanceAdapterError: class ManagedGuidanceAdapterError extends Error {},
	DEBUG_MANAGED_GUIDANCE_FLAG: "debug-managed-guidance",
	selectManagedPiGuidance: mocks.selectManagedPiGuidance,
	stageManagedPiGuidanceSelection: mocks.stageManagedPiGuidanceSelection,
	fetchManagedGuidance: mocks.fetchManagedGuidance,
	acknowledgeManagedGuidance: mocks.acknowledgeManagedGuidance,
	failManagedGuidance: mocks.failManagedGuidance,
	formatManagedGuidanceDebug: mocks.formatManagedGuidanceDebug,
	renderManagedGuidance: mocks.renderManagedGuidance,
}));

vi.mock("./prompt-builder.js", () => ({
	DEFAULT_PERSONA:
		"You are an expert coding assistant operating inside pi, a coding agent harness.",
	buildSystemPrompt: mocks.buildPrompt,
	loadClaudeLocalContextFiles: mocks.loadClaudeLocalContextFiles,
}));

vi.mock("./templates.js", () => ({
	parseDebugPromptOverrides: vi.fn(() => ({ overrides: null, error: null })),
	renderDynamicPrompt: mocks.renderDynamicPrompt,
}));

import systemPromptExtension from "./index.js";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.buildPrompt.mockReturnValue("<owned prompt />");
	mocks.loadClaudeLocalContextFiles.mockResolvedValue([]);
	mocks.renderDynamicPrompt.mockResolvedValue("<dynamic />");
	mocks.selectManagedPiGuidance.mockReturnValue({ kind: "unmanaged" });
	mocks.fetchManagedGuidance.mockReset();
	mocks.acknowledgeManagedGuidance.mockResolvedValue(undefined);
	mocks.failManagedGuidance.mockResolvedValue(undefined);
	mocks.renderManagedGuidance.mockReturnValue("<managed />");
	mocks.formatManagedGuidanceDebug.mockReturnValue('{"selection":"native-v1"}');
	mocks.isLegacyManagedPiEnvironment.mockReturnValue(false);
	mocks.resolveNativeIdentity.mockImplementation(async (_exec, options) => ({
		identity: "warm-silver-lemur",
		strandId: "identity-1",
		result: "minted" as const,
		instruction: "Your Millstrand identity is warm-silver-lemur.",
		nativeSessionId: options.nativeSessionId,
	}));
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
			events: { emit: vi.fn(), on: vi.fn() },
			on,
			registerFlag,
			registerCommand,
			registerTool: vi.fn(),
			getFlag,
			getActiveTools,
			sendUserMessage,
			exec,
		} as any);

		expect(registerFlag).toHaveBeenCalledTimes(6);
		expect(registerFlag).toHaveBeenCalledWith(
			"debug-prompt",
			expect.objectContaining({ type: "boolean", default: false }),
		);
		expect(registerFlag).toHaveBeenCalledWith(
			"debug-tools",
			expect.objectContaining({ type: "boolean", default: false }),
		);
		expect(registerCommand).toHaveBeenCalledWith(
			"debug-prompt",
			expect.objectContaining({ description: expect.any(String), handler: expect.any(Function) }),
		);
		expect(registerCommand).toHaveBeenCalledTimes(2);

		const counts = new Map<string, number>();
		for (const [eventName] of on.mock.calls) {
			counts.set(eventName, (counts.get(eventName) ?? 0) + 1);
		}

		expect(counts.get("session_start")).toBe(1);
		expect(counts.get("before_agent_start")).toBe(1);
		expect(counts.get("agent_start")).toBe(1);
		expect(counts.get("input")).toBe(1);
		expect(counts.get("before_provider_request")).toBe(1);
	});

	it("arms --debug-prompt without sending a synthetic ping", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const sendUserMessage = vi.fn();
		const notify = vi.fn();

		systemPromptExtension({
			events: { emit: vi.fn(), on: vi.fn() },
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

		await handlers.get("session_start")?.(
			{},
			{
				cwd: "/repo",
				hasUI: true,
				model: null,
				ui: { notify },
				sessionManager: { getSessionId: () => "session-1" },
			},
		);

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
			events: { emit: vi.fn(), on: vi.fn() },
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

		await handlers.get("session_start")?.(
			{},
			{
				cwd: "/repo",
				hasUI: true,
				model: { provider: "openai", id: "gpt-5" },
				sessionManager: { getSessionId: () => "session-1" },
			},
		);

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

		expect(getActiveTools).toHaveBeenCalledTimes(1);
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
				millstrandIdentityInstruction: "Your Millstrand identity is warm-silver-lemur.",
			}),
		);
		expect(mocks.renderDynamicPrompt).toHaveBeenCalledWith(
			{
				cwd: "/repo",
				hasUI: true,
				model: { provider: "openai", id: "gpt-5" },
				tools: ["write"],
			},
			null,
		);
		expect(mocks.renderDynamicPrompt).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			systemPrompt: "<owned prompt />",
		});
	});

	it("refetches and acknowledges managed guidance across startup, resume, and reload", async () => {
		const selection = {
			kind: "native-v1" as const,
			metadata: { "run-id": "run-1" },
			bootstrap: {},
		};
		const bundle = {
			identity: "coral-lucid-bison",
			workspace: "/world/.millstrand",
			context: { "identity-instruction": "canonical identity" },
		};
		mocks.selectManagedPiGuidance.mockReturnValue(selection as any);
		mocks.fetchManagedGuidance.mockResolvedValue(bundle);
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const emit = vi.fn();
		systemPromptExtension({
			events: { emit, on: vi.fn() },
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => []),
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);
		const ctx = {
			cwd: "/repo",
			hasUI: false,
			model: null,
			sessionManager: { getSessionId: () => "session-1" },
		};

		const event = {
			systemPrompt: "base",
			systemPromptOptions: {
				cwd: "/repo",
				selectedTools: [],
				toolSnippets: {},
				promptGuidelines: [],
			},
		};
		const results = [];
		for (const reason of ["startup", "resume", "reload"]) {
			await handlers.get("session_start")?.({ reason }, ctx);
			results.push(await handlers.get("before_agent_start")?.(event, ctx));
		}

		expect(mocks.resolveNativeIdentity).not.toHaveBeenCalled();
		expect(mocks.fetchManagedGuidance).toHaveBeenCalledTimes(3);
		expect(mocks.renderManagedGuidance).toHaveBeenCalledTimes(3);
		expect(mocks.renderManagedGuidance).toHaveBeenCalledWith(bundle);
		expect(mocks.buildPrompt).toHaveBeenCalledTimes(3);
		expect(mocks.buildPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				managedGuidance: "<managed />",
				millstrandIdentityInstruction: undefined,
			}),
		);
		expect(mocks.acknowledgeManagedGuidance).toHaveBeenCalledTimes(3);
		for (const call of mocks.acknowledgeManagedGuidance.mock.calls) {
			expect(call).toEqual([selection, "session-1", undefined, process.env, undefined]);
		}
		expect(results).toEqual([
			{ systemPrompt: "<owned prompt />" },
			{ systemPrompt: "<owned prompt />" },
			{ systemPrompt: "<owned prompt />" },
		]);
		expect(emit).toHaveBeenCalledWith(
			"codethread:millstrand-identity-context:v1",
			expect.objectContaining({ identity: "coral-lucid-bison", nativeSessionId: "session-1" }),
		);
	});

	it("debugs managed guidance after fetch, render, and acknowledgement, then exits", async () => {
		const selection = {
			kind: "native-v1" as const,
			metadata: { "run-id": "run-debug" },
			bootstrap: {},
		};
		const bundle = {
			identity: "coral-lucid-bison",
			workspace: "/world/.millstrand",
			context: { "identity-instruction": "canonical identity" },
		};
		mocks.selectManagedPiGuidance.mockReturnValue(selection as any);
		mocks.fetchManagedGuidance.mockResolvedValue(bundle);
		mocks.buildPrompt.mockReturnValue("<effective managed prompt />");
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		systemPromptExtension({
			events: { emit: vi.fn(), on: vi.fn() },
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn((name: string) => name === "debug-managed-guidance"),
			getActiveTools: vi.fn(() => []),
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);
		const ctx = {
			cwd: "/repo",
			hasUI: false,
			model: null,
			sessionManager: { getSessionId: () => "session-debug" },
		};
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

		try {
			await handlers.get("session_start")?.({ reason: "startup" }, ctx);
			await handlers.get("before_agent_start")?.(
				{
					systemPrompt: "base",
					systemPromptOptions: {
						cwd: "/repo",
						selectedTools: [],
						toolSnippets: {},
						promptGuidelines: [],
					},
				},
				ctx,
			);

			expect(mocks.fetchManagedGuidance).toHaveBeenCalledWith(
				selection,
				"session-debug",
				undefined,
				process.env,
				undefined,
			);
			expect(mocks.renderManagedGuidance).toHaveBeenCalledWith(bundle);
			expect(mocks.acknowledgeManagedGuidance).toHaveBeenCalledWith(
				selection,
				"session-debug",
				undefined,
				process.env,
				undefined,
			);
			expect(mocks.fetchManagedGuidance.mock.invocationCallOrder[0]).toBeLessThan(
				mocks.renderManagedGuidance.mock.invocationCallOrder[0],
			);
			expect(mocks.renderManagedGuidance.mock.invocationCallOrder[0]).toBeLessThan(
				mocks.acknowledgeManagedGuidance.mock.invocationCallOrder[0],
			);
			expect(stdout.mock.calls.map(([text]) => text)).toEqual([
				'{"selection":"native-v1"}\n',
				"<effective managed prompt />\n",
			]);
			expect(exit).toHaveBeenCalledWith(0);
			expect(mocks.acknowledgeManagedGuidance.mock.invocationCallOrder[0]).toBeLessThan(
				exit.mock.invocationCallOrder[0],
			);
		} finally {
			stdout.mockRestore();
			exit.mockRestore();
		}
	});

	it("renders templates once per session start and again after reload", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		systemPromptExtension({
			events: { emit: vi.fn(), on: vi.fn() },
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => ["read"]),
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);

		const ctx = {
			cwd: "/repo",
			hasUI: false,
			model: null,
			sessionManager: { getSessionId: () => "session-1" },
		};
		const event = {
			systemPrompt: "Base prompt",
			systemPromptOptions: {
				cwd: "/repo",
				selectedTools: ["read"],
				toolSnippets: { read: "Read files" },
				promptGuidelines: [],
			},
		};

		await handlers.get("session_start")?.({ reason: "startup" }, ctx);
		await handlers.get("before_agent_start")?.(event, ctx);
		await handlers.get("before_agent_start")?.(event, ctx);
		expect(mocks.renderDynamicPrompt).toHaveBeenCalledTimes(1);

		await handlers.get("session_start")?.({ reason: "reload" }, ctx);
		expect(mocks.renderDynamicPrompt).toHaveBeenCalledTimes(2);
		expect(mocks.resolveNativeIdentity).toHaveBeenCalledTimes(2);
	});

	it("re-resolves actual session IDs across resume, fork, and new lifecycles", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		let sessionId = "session-parent";
		systemPromptExtension({
			events: { emit: vi.fn(), on: vi.fn() },
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => []),
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);
		const ctx = {
			cwd: "/repo",
			hasUI: false,
			model: null,
			sessionManager: { getSessionId: () => sessionId },
		};

		await handlers.get("session_start")?.({ reason: "startup" }, ctx);
		await handlers.get("session_start")?.({ reason: "resume" }, ctx);
		sessionId = "session-fork";
		await handlers.get("session_start")?.({ reason: "fork" }, ctx);
		sessionId = "session-new";
		await handlers.get("session_start")?.({ reason: "new" }, ctx);

		expect(
			mocks.resolveNativeIdentity.mock.calls.map(([, options]) => options.nativeSessionId),
		).toEqual(["session-parent", "session-parent", "session-fork", "session-new"]);
	});

	it("replaces the current identity contribution after a fork", async () => {
		mocks.resolveNativeIdentity.mockImplementation(async (_exec, options) => ({
			identity: `${options.nativeSessionId}-identity`,
			strandId: `${options.nativeSessionId}-strand`,
			result: "minted" as const,
			instruction: `identity instruction for ${options.nativeSessionId}`,
			nativeSessionId: options.nativeSessionId,
		}));
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		let sessionId = "parent";
		systemPromptExtension({
			events: { emit: vi.fn(), on: vi.fn() },
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => []),
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);
		const ctx = {
			cwd: "/repo",
			hasUI: false,
			model: null,
			sessionManager: { getSessionId: () => sessionId },
		};
		const event = {
			systemPrompt: "copied parent prompt",
			systemPromptOptions: {
				cwd: "/repo",
				selectedTools: [],
				toolSnippets: {},
				promptGuidelines: [],
			},
		};

		await handlers.get("session_start")?.({ reason: "startup" }, ctx);
		await handlers.get("before_agent_start")?.(event, ctx);
		sessionId = "child";
		await handlers.get("session_start")?.({ reason: "fork" }, ctx);
		await handlers.get("before_agent_start")?.(event, ctx);

		const promptInputs = mocks.buildPrompt.mock.calls.map(
			(call) => (call as unknown[])[0] as { millstrandIdentityInstruction?: string },
		);
		expect(promptInputs.at(-2)?.millstrandIdentityInstruction).toBe(
			"identity instruction for parent",
		);
		expect(promptInputs.at(-1)?.millstrandIdentityInstruction).toBe(
			"identity instruction for child",
		);
	});

	it("keeps legacy managed prompt transport authoritative", async () => {
		mocks.selectManagedPiGuidance.mockReturnValue({
			kind: "legacy",
			reason: "managed metadata has no guidance document",
		} as any);
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		systemPromptExtension({
			events: { emit: vi.fn(), on: vi.fn() },
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => []),
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);
		const ctx = {
			cwd: "/repo",
			hasUI: false,
			model: null,
			sessionManager: { getSessionId: () => "managed-session" },
		};

		await handlers.get("session_start")?.({ reason: "startup" }, ctx);
		await handlers.get("before_agent_start")?.(
			{
				systemPrompt: "base",
				systemPromptOptions: {
					cwd: "/repo",
					selectedTools: [],
					toolSnippets: {},
					promptGuidelines: [],
					appendSystemPrompt: "legacy managed identity and frozen guidance",
				},
			},
			ctx,
		);

		expect(mocks.resolveNativeIdentity).not.toHaveBeenCalled();
		expect(mocks.buildPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				millstrandIdentityInstruction: undefined,
				appendSystemPrompt: "legacy managed identity and frozen guidance",
			}),
		);
	});

	it("reports identity resolution failure and continues unbound", async () => {
		mocks.resolveNativeIdentity.mockRejectedValueOnce(new Error("Strand unavailable"));
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const notify = vi.fn();
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		systemPromptExtension({
			events: { emit: vi.fn(), on: vi.fn() },
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => []),
			sendUserMessage: vi.fn(),
			exec: vi.fn(),
		} as any);

		await handlers.get("session_start")?.(
			{ reason: "startup" },
			{
				cwd: "/repo",
				hasUI: true,
				ui: { notify },
				model: null,
				sessionManager: { getSessionId: () => "session-1" },
			},
		);

		expect(notify).toHaveBeenCalledWith("[millstrand-identity] Strand unavailable", "error");
		expect(stderr).toHaveBeenCalledWith("[millstrand-identity] Strand unavailable\n");
		stderr.mockRestore();
	});

	it("warns when /debug-prompt is used before the first materialized turn", async () => {
		const registerCommand = vi.fn();
		const notify = vi.fn();

		systemPromptExtension({
			events: { emit: vi.fn(), on: vi.fn() },
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
			events: { emit: vi.fn(), on: vi.fn() },
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

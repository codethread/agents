import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./parser.js", () => ({
	renderNearestTemplate: vi.fn(),
}));

import dynamicAgentsMdExtension, { getTemplateVars, parseDebugPromptOverrides } from "./index.js";
import { renderNearestTemplate } from "./parser.js";

const originalPiSubagent = process.env.PI_SUBAGENT;

afterEach(() => {
	if (originalPiSubagent === undefined) delete process.env.PI_SUBAGENT;
	else process.env.PI_SUBAGENT = originalPiSubagent;
	vi.clearAllMocks();
});

describe("parseDebugPromptOverrides", () => {
	it("returns null overrides for bare --debug-prompt", () => {
		expect(parseDebugPromptOverrides(["--debug-prompt"])).toEqual({
			overrides: null,
			error: null,
		});
	});

	it("parses JSON from a separate argument", () => {
		expect(parseDebugPromptOverrides(["--debug-prompt", '{"model":"claude-sonnet"}'])).toEqual({
			overrides: { model: "claude-sonnet" },
			error: null,
		});
	});

	it("parses JSON from --debug-prompt=<json>", () => {
		expect(parseDebugPromptOverrides(['--debug-prompt={"model":"claude-sonnet"}'])).toEqual({
			overrides: { model: "claude-sonnet" },
			error: null,
		});
	});

	it("ignores non-JSON-looking values to preserve bare-flag behavior", () => {
		expect(parseDebugPromptOverrides(["--debug-prompt", "ping"])).toEqual({
			overrides: null,
			error: null,
		});
	});

	it("rejects invalid object JSON", () => {
		expect(parseDebugPromptOverrides(["--debug-prompt", '{"model":}'])).toEqual({
			overrides: null,
			error: expect.stringContaining("Invalid --debug-prompt JSON:"),
		});
	});
});

describe("debug prompt startup", () => {
	it("starts a synthetic ping turn during session_start", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const sendUserMessage = vi.fn();
		const notify = vi.fn();

		dynamicAgentsMdExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			getFlag: vi.fn((name: string) => name === "debug-prompt"),
			getActiveTools: vi.fn(() => ["read"]),
			sendUserMessage,
		} as any);

		await handlers.get("session_start")?.({}, { hasUI: true, ui: { notify } });

		expect(sendUserMessage).toHaveBeenCalledWith("ping");
		expect(notify).toHaveBeenCalledWith(
			"Debug prompt mode: starting a ping turn to materialize the prompt.",
			"info",
		);
	});
});

describe("before_agent_start", () => {
	it("prefers event.systemPromptOptions.selectedTools over rediscovering active tools", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const getActiveTools = vi.fn(() => ["read"]);
		vi.mocked(renderNearestTemplate).mockResolvedValue({
			renderedPrompt: '<system-reminder type="rules">Prompt</system-reminder>',
		} as any);

		dynamicAgentsMdExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools,
			sendUserMessage: vi.fn(),
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

		expect(renderNearestTemplate).toHaveBeenCalledWith(
			"/repo",
			expect.objectContaining({ tools: ["bash", "edit"] }),
		);
		expect(getActiveTools).not.toHaveBeenCalled();
		expect(result).toEqual({
			systemPrompt: 'Base prompt\n\n<system-reminder type="rules">Prompt</system-reminder>',
		});
	});
});

describe("getTemplateVars", () => {
	it("marks the top-level runtime as the main agent by default", () => {
		delete process.env.PI_SUBAGENT;
		const vars = getTemplateVars({
			cwd: "/repo",
			hasUI: true,
			tools: ["read"],
		});

		expect(vars).toMatchObject({
			isMainAgent: true,
			isSubagent: false,
		});
	});

	it("marks delegated runtimes as subagents", () => {
		process.env.PI_SUBAGENT = "1";
		const vars = getTemplateVars({
			cwd: "/repo",
			hasUI: false,
			tools: ["read"],
		});

		expect(vars).toMatchObject({
			isMainAgent: false,
			isSubagent: true,
		});
	});

	it("lets overrides replace machine-derived vars", () => {
		const ctx: Parameters<typeof getTemplateVars>[0] = {
			cwd: "/repo",
			hasUI: true,
			tools: ["read", "write"],
			model: {
				provider: "openai",
				id: "gpt-5",
			},
		};
		const vars = getTemplateVars(ctx, {
			model: "claude-sonnet",
			HOME: "/tmp/fake-home",
			isMainAgent: false,
		});

		expect(vars).toMatchObject({
			provider: "openai",
			model: "claude-sonnet",
			cwd: "/repo",
			hasUI: true,
			isMainAgent: false,
			tools: ["read", "write"],
			HOME: "/tmp/fake-home",
		});
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./parser.js", () => ({
	renderNearestTemplate: vi.fn(),
}));

import { getTemplateVars, parseDebugPromptOverrides, renderDynamicAgentsPrompt } from "./index.js";
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

describe("renderDynamicAgentsPrompt", () => {
	it("renders the nearest template with computed vars", async () => {
		vi.mocked(renderNearestTemplate).mockResolvedValue({
			filePath: "/repo/.pi/agent.njk",
			renderedPrompt: '<system-reminder type="rules">Prompt</system-reminder>',
		});

		const result = await renderDynamicAgentsPrompt({
			cwd: "/repo",
			hasUI: true,
			tools: ["bash", "edit"],
			model: { provider: "openai", id: "gpt-5" },
		});

		expect(renderNearestTemplate).toHaveBeenCalledWith(
			"/repo",
			expect.objectContaining({
				provider: "openai",
				model: "gpt-5",
				cwd: "/repo",
				hasUI: true,
				tools: ["bash", "edit"],
			}),
		);
		expect(result).toBe('<system-reminder type="rules">Prompt</system-reminder>');
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

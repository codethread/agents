import { afterEach, describe, expect, it, vi } from "vitest";
import questionnaireExtension from "./index.js";

interface TestContext {
	hasUI: boolean;
}

type SessionStartHandler = (event: unknown, ctx: TestContext) => unknown | Promise<unknown>;

const originalPiSubagent = process.env.PI_SUBAGENT;

afterEach(() => {
	if (originalPiSubagent === undefined) delete process.env.PI_SUBAGENT;
	else process.env.PI_SUBAGENT = originalPiSubagent;
});

function setupExtension(activeTools = ["questionnaire", "subagent", "read"]) {
	const handlers = new Map<string, SessionStartHandler>();
	const registerTool = vi.fn();
	const setActiveTools = vi.fn();
	const getActiveTools = vi.fn(() => [...activeTools]);

	questionnaireExtension({
		on(eventName: string, handler: SessionStartHandler) {
			handlers.set(eventName, handler);
		},
		registerTool,
		setActiveTools,
		getActiveTools,
	} as any);

	return {
		sessionStartHandler: handlers.get("session_start"),
		registerTool,
		setActiveTools,
		getActiveTools,
	};
}

describe("questionnaire extension", () => {
	it("registers the questionnaire tool", () => {
		const { registerTool } = setupExtension();

		expect(registerTool).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "questionnaire",
				label: "Questionnaire",
			}),
		);
	});

	it("keeps questionnaire active in normal sessions", async () => {
		const { sessionStartHandler, setActiveTools } = setupExtension();
		process.env.PI_SUBAGENT = "1";

		await sessionStartHandler?.({}, { hasUI: true });

		expect(setActiveTools).not.toHaveBeenCalled();
	});

	it("hides questionnaire when running headless subagents", async () => {
		const { sessionStartHandler, setActiveTools } = setupExtension();
		process.env.PI_SUBAGENT = "1";

		await sessionStartHandler?.({}, { hasUI: false });

		expect(setActiveTools).toHaveBeenCalledWith(["subagent", "read"]);
	});

	it("does not change active tools without the subagent marker", async () => {
		const { sessionStartHandler, setActiveTools } = setupExtension();

		await sessionStartHandler?.({}, { hasUI: false });

		expect(setActiveTools).not.toHaveBeenCalled();
	});
});

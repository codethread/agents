import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		matchesKey: vi.fn((data: string, keyId: string) => data === keyId),
	};
});

const mocks = vi.hoisted(() => ({
	openMarkdownInExternalEditor: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("./external-editor.js", () => ({
	openMarkdownInExternalEditor: mocks.openMarkdownInExternalEditor,
}));

import { showDebugMessage } from "./index.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as any;

function createCustomUi(...inputs: string[]) {
	return vi.fn(async (factory: any) => {
		const nextInput = inputs.shift();
		let result: unknown;
		const component = await factory({} as any, theme, {} as any, (value: unknown) => {
			result = value;
		});
		component.handleInput(nextInput);
		return result;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("showDebugMessage", () => {
	it("opens the markdown body in the external editor and then re-renders the panel", async () => {
		const custom = createCustomUi("ctrl+g", "escape");
		const notify = vi.fn();
		const sendMarkdownToAgent = vi.fn();

		await showDebugMessage(
			{
				hasUI: true,
				ui: { custom, notify },
			} as any,
			{
				headingText: "TL;DR",
				subheadingText: "using openai/gpt-5.4-nano",
				markdownBody: "## Summary\n\nOnly the markdown body should be written.",
				sendMarkdownToAgent,
			},
		);

		expect(mocks.openMarkdownInExternalEditor).toHaveBeenCalledWith(
			"## Summary\n\nOnly the markdown body should be written.",
			expect.objectContaining({
				fileNameStem: "TL;DR",
				signal: expect.any(AbortSignal),
			}),
		);
		expect(custom).toHaveBeenCalledTimes(3);
		expect(sendMarkdownToAgent).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
	});

	it("sends the markdown body to the agent on ctrl+enter", async () => {
		const custom = createCustomUi("ctrl+enter");
		const notify = vi.fn();
		const sendMarkdownToAgent = vi.fn(async () => {});

		await showDebugMessage(
			{
				hasUI: true,
				ui: { custom, notify },
			} as any,
			{
				headingText: "Debug Prompt",
				subheadingText: "using local render",
				markdownBody: "# Prompt\n\nRendered prompt body",
				sendMarkdownToAgent,
			},
		);

		expect(sendMarkdownToAgent).toHaveBeenCalledWith("# Prompt\n\nRendered prompt body");
		expect(notify).toHaveBeenCalledWith("Debug content sent to agent", "info");
		expect(mocks.openMarkdownInExternalEditor).not.toHaveBeenCalled();
	});
});

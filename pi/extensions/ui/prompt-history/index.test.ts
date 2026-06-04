import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	appendPromptHistoryRecord: vi.fn<() => Promise<string>>(
		async () => "/tmp/cache/pi/messages.jsonl",
	),
	createPromptHistoryRecord: vi.fn<(value: any) => any>((value) => ({
		version: 1,
		timestamp: 1,
		...value,
	})),
	getPromptHistoryCachePath: vi.fn<() => string>(() => "/tmp/cache/pi/messages.jsonl"),
	loadPromptHistoryRecords: vi.fn<() => Promise<any[]>>(async () => []),
	resolvePromptHistoryGitContext: vi.fn<
		() => Promise<{ cwd: string; repoRoot: string } | undefined>
	>(async () => ({ cwd: "/repo/app", repoRoot: "/repo" })),
}));

vi.mock("./history.js", () => ({
	appendPromptHistoryRecord: mocks.appendPromptHistoryRecord,
	createPromptHistoryRecord: mocks.createPromptHistoryRecord,
	getPromptHistoryCachePath: mocks.getPromptHistoryCachePath,
	loadPromptHistoryRecords: mocks.loadPromptHistoryRecords,
}));

vi.mock("./git.js", () => ({
	resolvePromptHistoryGitContext: mocks.resolvePromptHistoryGitContext,
}));

import promptHistoryExtension from "./index.js";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolvePromptHistoryGitContext.mockResolvedValue({ cwd: "/repo/app", repoRoot: "/repo" });
	mocks.loadPromptHistoryRecords.mockResolvedValue([]);
});

describe("prompt-history extension", () => {
	it("registers one flag, three shortcuts, and session/message handlers", () => {
		const on = vi.fn();
		const registerFlag = vi.fn();
		const registerShortcut = vi.fn();

		promptHistoryExtension({
			on,
			registerFlag,
			registerShortcut,
			getFlag: vi.fn(() => false),
			exec: vi.fn(),
		} as any);

		expect(registerFlag).toHaveBeenCalledWith(
			"debug-prompt-history",
			expect.objectContaining({ type: "boolean", default: false }),
		);
		expect(registerShortcut).toHaveBeenCalledTimes(3);

		const events = on.mock.calls.map(([eventName]) => eventName);
		expect(events).toEqual(["session_start", "message_end"]);
	});

	it("records submitted user prompts inside git repositories", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();

		promptHistoryExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerShortcut: vi.fn(),
			getFlag: vi.fn(() => false),
			exec: vi.fn(),
		} as any);

		await handlers.get("message_end")?.(
			{
				message: {
					role: "user",
					content: [
						{ type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } },
						{ type: "text", text: "first line" },
						{ type: "text", text: "second line" },
					],
				},
			},
			{ cwd: "/repo/app", signal: undefined, hasUI: false },
		);

		expect(mocks.createPromptHistoryRecord).toHaveBeenCalledWith({
			message: "first line\n\nsecond line",
			cwd: "/repo/app",
			repoRoot: "/repo",
		});
		expect(mocks.appendPromptHistoryRecord).toHaveBeenCalledTimes(1);
	});

	it("cycles recalled prompts within a loaded scope buffer", async () => {
		const shortcuts = new Map<string, (ctx: any) => unknown | Promise<unknown>>();
		const setEditorText = vi.fn();
		mocks.loadPromptHistoryRecords.mockResolvedValue([
			{ version: 1, timestamp: 3, message: "latest", cwd: "/repo/app", repoRoot: "/repo" },
			{ version: 1, timestamp: 2, message: "older", cwd: "/repo/app", repoRoot: "/repo" },
		]);

		promptHistoryExtension({
			on: vi.fn(),
			registerFlag: vi.fn(),
			registerShortcut(
				shortcut: string,
				options: { handler: (ctx: any) => unknown | Promise<unknown> },
			) {
				shortcuts.set(shortcut, options.handler);
			},
			getFlag: vi.fn(() => false),
			exec: vi.fn(),
		} as any);

		const ctx = {
			cwd: "/repo/app",
			signal: undefined,
			hasUI: true,
			ui: { setEditorText, notify: vi.fn() },
		};
		await shortcuts.get("ctrl+p")?.(ctx);
		await shortcuts.get("ctrl+p")?.(ctx);

		expect(mocks.loadPromptHistoryRecords).toHaveBeenCalledTimes(1);
		expect(setEditorText).toHaveBeenNthCalledWith(1, "latest");
		expect(setEditorText).toHaveBeenNthCalledWith(2, "older");
	});

	it("reloads recall results after a new prompt is appended", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const shortcuts = new Map<string, (ctx: any) => unknown | Promise<unknown>>();
		const setEditorText = vi.fn();
		mocks.loadPromptHistoryRecords
			.mockResolvedValueOnce([
				{ version: 1, timestamp: 2, message: "older", cwd: "/repo/app", repoRoot: "/repo" },
			])
			.mockResolvedValueOnce([
				{ version: 1, timestamp: 3, message: "newest", cwd: "/repo/app", repoRoot: "/repo" },
				{ version: 1, timestamp: 2, message: "older", cwd: "/repo/app", repoRoot: "/repo" },
			]);

		promptHistoryExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerShortcut(
				shortcut: string,
				options: { handler: (ctx: any) => unknown | Promise<unknown> },
			) {
				shortcuts.set(shortcut, options.handler);
			},
			getFlag: vi.fn(() => false),
			exec: vi.fn(),
		} as any);

		const ctx = {
			cwd: "/repo/app",
			signal: undefined,
			hasUI: true,
			ui: { setEditorText, notify: vi.fn() },
		};
		await shortcuts.get("ctrl+p")?.(ctx);
		await handlers.get("message_end")?.(
			{ message: { role: "user", content: [{ type: "text", text: "newest" }] } },
			ctx,
		);
		await shortcuts.get("ctrl+p")?.(ctx);

		expect(mocks.loadPromptHistoryRecords).toHaveBeenCalledTimes(2);
		expect(setEditorText).toHaveBeenNthCalledWith(1, "older");
		expect(setEditorText).toHaveBeenNthCalledWith(2, "newest");
	});

	it("shows a warning instead of recalling outside git repositories", async () => {
		const shortcuts = new Map<string, (ctx: any) => unknown | Promise<unknown>>();
		const notify = vi.fn();
		mocks.resolvePromptHistoryGitContext.mockResolvedValue(undefined);

		promptHistoryExtension({
			on: vi.fn(),
			registerFlag: vi.fn(),
			registerShortcut(
				shortcut: string,
				options: { handler: (ctx: any) => unknown | Promise<unknown> },
			) {
				shortcuts.set(shortcut, options.handler);
			},
			getFlag: vi.fn(() => false),
			exec: vi.fn(),
		} as any);

		await shortcuts.get("up")?.({
			cwd: "/tmp",
			signal: undefined,
			hasUI: true,
			ui: { notify, setEditorText: vi.fn() },
		});

		expect(notify).toHaveBeenCalledWith(
			"Prompt history is unavailable outside git repositories.",
			"warning",
		);
		expect(mocks.loadPromptHistoryRecords).not.toHaveBeenCalled();
	});
});

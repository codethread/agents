import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
	vi.unstubAllEnvs();
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
		expect(registerShortcut.mock.calls.map(([shortcut]) => shortcut)).toEqual([
			"ctrl+p",
			"ctrl+shift+p",
			"ctrl+r",
		]);

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
			{ cwd: "/repo/app", signal: undefined, hasUI: true },
		);

		expect(mocks.createPromptHistoryRecord).toHaveBeenCalledWith({
			message: "first line\n\nsecond line",
			cwd: "/repo/app",
			repoRoot: "/repo",
		});
		expect(mocks.appendPromptHistoryRecord).toHaveBeenCalledTimes(1);
	});

	it("does not record prompts in non-interactive sessions", async () => {
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
			{ message: { role: "user", content: "headless prompt" } },
			{ cwd: "/repo/app", signal: undefined, hasUI: false },
		);

		expect(mocks.resolvePromptHistoryGitContext).not.toHaveBeenCalled();
		expect(mocks.appendPromptHistoryRecord).not.toHaveBeenCalled();
	});

	it("cycles recalled prompts within a loaded scope buffer", async () => {
		const shortcuts = new Map<string, (ctx: any) => unknown | Promise<unknown>>();
		const setEditorText = vi.fn();
		const setStatus = vi.fn();
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
			ui: { setEditorText, setStatus, notify: vi.fn() },
		};
		await shortcuts.get("ctrl+p")?.(ctx);
		await shortcuts.get("ctrl+p")?.(ctx);

		expect(mocks.resolvePromptHistoryGitContext).toHaveBeenCalledTimes(1);
		expect(mocks.loadPromptHistoryRecords).toHaveBeenCalledTimes(1);
		expect(setEditorText).toHaveBeenNthCalledWith(1, "latest");
		expect(setEditorText).toHaveBeenNthCalledWith(2, "older");
		expect(setStatus).toHaveBeenCalledTimes(2);
		expect(setStatus).toHaveBeenCalledWith("prompt-history", undefined);
	});

	it("avoids reloading loaded recall results after a new prompt is appended", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const shortcuts = new Map<string, (ctx: any) => unknown | Promise<unknown>>();
		const setEditorText = vi.fn();
		mocks.loadPromptHistoryRecords.mockResolvedValueOnce([
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
			ui: { setEditorText, setStatus: vi.fn(), notify: vi.fn() },
		};
		await shortcuts.get("ctrl+p")?.(ctx);
		await handlers.get("message_end")?.({ message: { role: "user", content: "newest" } }, ctx);
		await shortcuts.get("ctrl+p")?.(ctx);

		expect(mocks.appendPromptHistoryRecord).toHaveBeenCalledTimes(1);
		expect(mocks.createPromptHistoryRecord).toHaveBeenCalledWith({
			message: "newest",
			cwd: "/repo/app",
			repoRoot: "/repo",
		});
		expect(mocks.resolvePromptHistoryGitContext).toHaveBeenCalledTimes(1);
		expect(mocks.loadPromptHistoryRecords).toHaveBeenCalledTimes(1);
		expect(setEditorText).toHaveBeenNthCalledWith(1, "older");
		expect(setEditorText).toHaveBeenCalledTimes(2);
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

		await shortcuts.get("ctrl+p")?.({
			cwd: "/tmp",
			signal: undefined,
			hasUI: true,
			ui: { notify, setEditorText: vi.fn(), setStatus: vi.fn() },
		});

		expect(notify).toHaveBeenCalledWith(
			"Prompt history is unavailable outside git repositories.",
			"warning",
		);
		expect(mocks.loadPromptHistoryRecords).not.toHaveBeenCalled();
	});

	it("inserts the prompt selected in the fzf-tmux picker", async () => {
		const shortcuts = new Map<string, (ctx: any) => unknown | Promise<unknown>>();
		const setEditorText = vi.fn();
		const setStatus = vi.fn();
		const selection = {
			version: 1,
			timestamp: 3,
			message: "multi\nline prompt",
			cwd: "/repo/app",
			repoRoot: "/repo",
		};
		const exec = vi.fn<
			(
				command: string,
				args: string[],
				options?: { cwd?: string },
			) => Promise<{
				stdout: string;
				stderr: string;
				code: number;
				killed: boolean;
			}>
		>(async () => ({
			stdout: `2026-09-19 05:36  app  multi line prompt\t${JSON.stringify(selection)}\n`,
			stderr: "",
			code: 0,
			killed: false,
		}));
		vi.stubEnv("TMUX", "/tmp/tmux-501/default,123,0");

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
			exec,
		} as any);

		await shortcuts.get("ctrl+r")?.({
			cwd: "/repo/app",
			signal: undefined,
			hasUI: true,
			ui: { setEditorText, setStatus, notify: vi.fn() },
		});

		expect(exec).toHaveBeenCalledTimes(1);
		const [command, args, options] = exec.mock.calls[0];
		expect(command).toBe("bash");
		expect(args[0]).toBe("-c");
		expect(args.slice(3)).toEqual(["/tmp/cache/pi/messages.jsonl", "/repo", "/repo/app"]);
		expect(options).toEqual({ cwd: "/repo/app" });
		expect(setEditorText).toHaveBeenCalledWith("multi\nline prompt");
		expect(setStatus).toHaveBeenCalledWith("prompt-history", undefined);
	});

	it("requires tmux before opening the fuzzy picker", async () => {
		const shortcuts = new Map<string, (ctx: any) => unknown | Promise<unknown>>();
		const notify = vi.fn();
		const exec = vi.fn();
		vi.stubEnv("TMUX", "");

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
			exec,
		} as any);

		await shortcuts.get("ctrl+r")?.({
			cwd: "/repo/app",
			signal: undefined,
			hasUI: true,
			ui: { notify, setEditorText: vi.fn(), setStatus: vi.fn() },
		});

		expect(exec).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("tmux"), "warning");
	});

	it("warns instead of picking outside git repositories", async () => {
		const shortcuts = new Map<string, (ctx: any) => unknown | Promise<unknown>>();
		const notify = vi.fn();
		const exec = vi.fn();
		mocks.resolvePromptHistoryGitContext.mockResolvedValue(undefined);
		vi.stubEnv("TMUX", "/tmp/tmux-501/default,123,0");

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
			exec,
		} as any);

		await shortcuts.get("ctrl+r")?.({
			cwd: "/tmp",
			signal: undefined,
			hasUI: true,
			ui: { notify, setEditorText: vi.fn(), setStatus: vi.fn() },
		});

		expect(exec).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(
			"Prompt history is unavailable outside git repositories.",
			"warning",
		);
	});

	it("reports picker failures and empty results without touching the editor", async () => {
		const shortcuts = new Map<string, (ctx: any) => unknown | Promise<unknown>>();
		const notify = vi.fn();
		const setEditorText = vi.fn();
		vi.stubEnv("TMUX", "/tmp/tmux-501/default,123,0");

		const exec = vi.fn<
			(
				command: string,
				args: string[],
				options?: { cwd?: string },
			) => Promise<{
				stdout: string;
				stderr: string;
				code: number;
				killed: boolean;
			}>
		>(async () => ({ stdout: "", stderr: "", code: 1, killed: false }));

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
			exec,
		} as any);

		const ctx = {
			cwd: "/repo/app",
			signal: undefined,
			hasUI: true,
			ui: { notify, setEditorText, setStatus: vi.fn() },
		};

		await shortcuts.get("ctrl+r")?.(ctx);
		expect(notify).toHaveBeenCalledWith("No prompt history found for repo scope.", "info");
		expect(setEditorText).not.toHaveBeenCalled();

		notify.mockClear();
		exec.mockResolvedValue({ stdout: "", stderr: "", code: 130, killed: false });
		await shortcuts.get("ctrl+r")?.(ctx);
		expect(notify).not.toHaveBeenCalled();
		expect(setEditorText).not.toHaveBeenCalled();

		notify.mockClear();
		exec.mockResolvedValue({
			stdout: "",
			stderr: "prompt-history: Ctrl+R fuzzy history requires jq on PATH.\n",
			code: 3,
			killed: false,
		});
		await shortcuts.get("ctrl+r")?.(ctx);
		expect(notify).toHaveBeenCalledWith(
			"prompt-history: Ctrl+R fuzzy history requires jq on PATH.",
			"warning",
		);
		expect(setEditorText).not.toHaveBeenCalled();
	});
});

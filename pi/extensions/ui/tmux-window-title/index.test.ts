import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import tmuxWindowTitleExtension from "./index.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

afterEach(() => {
	vi.unstubAllEnvs();
	spawnMock.mockReset();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function setupExtension(title: string | null = "fix-tests", inTmux = true, inRex = false) {
	vi.stubEnv("TMUX", inTmux ? "/tmp/tmux-test/default,1,0" : "");
	vi.stubEnv("TMUX_PANE", "%7");
	vi.stubEnv("REX_SESSION", inRex ? "session:test" : "");
	vi.stubEnv("REX_BLOCK", inRex ? "block:test" : "");
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const exec = vi.fn(async (_command: string, args: string[]) => ({
		stdout:
			args[0] === "display-message"
				? "@17\n"
				: args[1] === "inspect"
					? JSON.stringify({ block: { window_id: "window:original" } })
					: "",
		stderr: "",
		code: 0,
		killed: false,
	}));
	const appendEntry = vi.fn();
	const branch: unknown[] = title
		? [{ type: "custom", customType: "tmux-window-title", data: { title } }]
		: [];
	const ctx = {
		cwd: process.cwd(),
		hasUI: true,
		ui: { setTitle: vi.fn(), notify: vi.fn() },
		sessionManager: { getBranch: () => branch },
		modelRegistry: {
			getAvailable: vi.fn(async (): Promise<unknown[]> => []),
			getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "test-key" })),
		},
	};

	tmuxWindowTitleExtension({
		exec,
		appendEntry,
		getFlag: () => false,
		registerFlag: vi.fn(),
		on: (event: string, handler: (...args: any[]) => unknown) => handlers.set(event, handler),
	} as any);

	return {
		ctx,
		exec,
		appendEntry,
		branch,
		emit: async (type: string, event: unknown = { type }) => handlers.get(type)?.(event, ctx),
		titles: () => ctx.ui.setTitle.mock.calls.map(([value]) => value),
	};
}

describe("tmux settled marker", () => {
	it("marks only final settlement, clears on the next run, and never persists the marker", async () => {
		const { emit, titles, exec, appendEntry } = setupExtension();
		await emit("session_start");
		await emit("agent_start");
		await emit("agent_end");
		expect(titles()).toEqual(["fix-tests"]);

		await emit("agent_settled");
		await emit("agent_settled");
		expect(titles().slice(-2)).toEqual(["● fix-tests", "● fix-tests"]);
		expect(exec).toHaveBeenLastCalledWith("tmux", ["rename-window", "-t", "@17", "● fix-tests"], {
			timeout: 5000,
		});
		await emit("agent_start");
		expect(titles().at(-1)).toBe("fix-tests");
		await emit("agent_settled");
		await emit("session_shutdown");
		expect(titles().at(-1)).toBe("fix-tests");
		expect(appendEntry).not.toHaveBeenCalled();
	});

	it.each([true, false])(
		"marks untitled sessions even without a title model (tmux=%s)",
		async (inTmux) => {
			const { emit, titles, exec, branch } = setupExtension(null, inTmux);
			branch.push({ type: "message", message: { role: "user", content: "Fix tests" } });
			await emit("session_start");
			await emit("agent_settled");
			expect(titles().at(-1)).toBe("● pi");
			await emit("agent_start");
			expect(titles().at(-1)).toBe("pi");
			if (!inTmux) expect(exec).not.toHaveBeenCalled();
		},
	);

	it.each([
		[false, false],
		[true, false],
		[false, true],
		[true, true],
	])(
		"keeps the current status when title generation finishes late (restarted=%s, rex=%s)",
		async (restarted, inRex) => {
			const { emit, titles, ctx, appendEntry, exec } = setupExtension(null, !inRex, inRex);
			ctx.modelRegistry.getAvailable.mockResolvedValue([
				{ provider: "openai", id: "gpt-5.4-nano", reasoning: true },
			]);
			const child = Object.assign(new EventEmitter(), {
				stdout: new PassThrough(),
				stderr: new PassThrough(),
			});
			const spawned = deferred<void>();
			spawnMock.mockImplementation(() => {
				spawned.resolve();
				return child;
			});
			const persisted = deferred<void>();
			appendEntry.mockImplementation(() => persisted.resolve());

			await emit("session_start");
			await emit("message_end", {
				type: "message_end",
				message: { role: "user", content: "Fix tests" },
			});
			await spawned.promise;
			await emit("agent_settled");
			if (restarted) await emit("agent_start");
			child.stdout.write(
				`${JSON.stringify({
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "Fix tests" }] },
				})}\n`,
			);
			child.emit("close", 0);
			await persisted.promise;

			expect(titles().at(-1)).toBe(restarted ? "fix-tests" : "● fix-tests");
			if (inRex) {
				expect(exec).toHaveBeenLastCalledWith(
					"rex",
					[
						"window",
						"rename",
						"-s",
						"session:test",
						"window:original",
						restarted ? "fix-tests" : "● fix-tests",
					],
					{ timeout: 5000 },
				);
			}
			expect(appendEntry).toHaveBeenCalledWith("tmux-window-title", {
				title: "fix-tests",
				rawTitle: "Fix tests",
				model: "openai/gpt-5.4-nano:off",
			});
		},
	);

	it("serializes overlapping status updates and clears the final tmux title", async () => {
		const { emit, titles, exec } = setupExtension();
		await emit("session_start");
		const started = deferred<void>();
		const rename = deferred<Awaited<ReturnType<typeof exec>>>();
		exec.mockImplementationOnce(() => {
			started.resolve();
			return rename.promise;
		});
		const settle = emit("agent_settled");
		await started.promise;
		const restart = emit("agent_start");
		expect(titles().at(-1)).toBe("● fix-tests");
		rename.resolve({ stdout: "", stderr: "", code: 0, killed: false });
		await Promise.all([settle, restart]);
		expect(titles().at(-1)).toBe("fix-tests");
		expect(exec).toHaveBeenLastCalledWith("tmux", ["rename-window", "-t", "@17", "fix-tests"], {
			timeout: 5000,
		});
	});

	it("reports a failed rename without blocking later status updates", async () => {
		const { emit, exec, ctx } = setupExtension();
		await emit("session_start");
		exec.mockResolvedValueOnce({ stdout: "", stderr: "window missing", code: 1, killed: false });
		await emit("agent_settled");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"tmux-window-title: failed to update title: window missing",
			"warning",
		);
		await emit("agent_start");
		expect(exec).toHaveBeenLastCalledWith("tmux", ["rename-window", "-t", "@17", "fix-tests"], {
			timeout: 5000,
		});
	});
});

describe("Rex tab titles", () => {
	it("captures the originating tab once, restores the label, and marks and clears settlement", async () => {
		const { emit, exec, titles, appendEntry } = setupExtension("fix-tests", false, true);
		await emit("session_start");
		expect(exec).toHaveBeenNthCalledWith(
			1,
			"rex",
			["block", "inspect", "-s", "session:test", "block:test", "--json"],
			{ timeout: 5000 },
		);
		expect(exec).toHaveBeenLastCalledWith(
			"rex",
			["window", "rename", "-s", "session:test", "window:original", "fix-tests"],
			{ timeout: 5000 },
		);

		// Focus and inherited environment changes must not redirect later writes.
		vi.stubEnv("REX_SESSION", "session:other");
		vi.stubEnv("REX_BLOCK", "block:other");
		await emit("agent_end");
		expect(titles()).toEqual(["fix-tests"]);
		await emit("agent_settled");
		expect(exec).toHaveBeenLastCalledWith(
			"rex",
			["window", "rename", "-s", "session:test", "window:original", "● fix-tests"],
			{ timeout: 5000 },
		);
		await emit("agent_start");
		expect(titles().at(-1)).toBe("fix-tests");
		await emit("agent_settled");
		await emit("session_shutdown");
		expect(exec).toHaveBeenLastCalledWith(
			"rex",
			["window", "rename", "-s", "session:test", "window:original", "fix-tests"],
			{ timeout: 5000 },
		);
		expect(exec.mock.calls.filter(([, args]) => args[1] === "inspect")).toHaveLength(1);
		expect(
			exec.mock.calls.every(([command, args]) => command === "rex" && args[0] !== "session"),
		).toBe(true);
		expect(appendEntry).not.toHaveBeenCalled();
	});

	it("uses tmux windows when tmux is nested inside Rex", async () => {
		const { emit, exec } = setupExtension("fix-tests", true, true);
		await emit("session_start");
		await emit("agent_settled");
		expect(exec.mock.calls.every(([command]) => command === "tmux")).toBe(true);
	});

	it.each([
		{ stdout: "", stderr: "Rex unavailable", code: 1 },
		{ stdout: "not json", stderr: "", code: 0 },
		{ stdout: JSON.stringify({ block: {} }), stderr: "", code: 0 },
	])("reports capture failures without renaming an unrelated tab: %j", async (result) => {
		const { emit, exec, ctx } = setupExtension("fix-tests", false, true);
		exec.mockResolvedValueOnce({ ...result, killed: false });
		await emit("session_start");
		await emit("agent_settled");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("failed to capture title target:"),
			"warning",
		);
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it("reports incomplete Rex context instead of selecting the focused tab", async () => {
		const { emit, exec, ctx } = setupExtension("fix-tests", false, true);
		vi.stubEnv("REX_BLOCK", "");
		await emit("session_start");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"tmux-window-title: failed to capture title target: Rex requires both REX_SESSION and REX_BLOCK",
			"warning",
		);
		expect(exec).not.toHaveBeenCalled();
	});

	it("reports failed Rex renames and allows the next status update", async () => {
		const { emit, exec, ctx } = setupExtension("fix-tests", false, true);
		await emit("session_start");
		exec.mockResolvedValueOnce({ stdout: "", stderr: "tab closed", code: 1, killed: false });
		await emit("agent_settled");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"tmux-window-title: failed to update title: tab closed",
			"warning",
		);
		await emit("agent_start");
		expect(exec).toHaveBeenLastCalledWith(
			"rex",
			["window", "rename", "-s", "session:test", "window:original", "fix-tests"],
			{ timeout: 5000 },
		);
	});
});

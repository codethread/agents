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

function setupExtension(title: string | null = "fix-tests", inTmux = true) {
	vi.stubEnv("TMUX", inTmux ? "/tmp/tmux-test/default,1,0" : "");
	vi.stubEnv("TMUX_PANE", "%7");
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const exec = vi.fn(async (_command: string, args: string[]) => ({
		stdout: args[0] === "display-message" ? "@17\n" : "",
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
		emit: async (type: string) => handlers.get(type)?.({ type }, ctx),
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

	it.each([false, true])(
		"keeps the current status when title generation finishes late (restarted=%s)",
		async (restarted) => {
			const { emit, titles, ctx, branch, appendEntry } = setupExtension(null);
			branch.push({ type: "message", message: { role: "user", content: "Fix tests" } });
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

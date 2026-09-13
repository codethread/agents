import { describe, expect, it, vi } from "vitest";
import interactiveShell from "./index.js";
import { InteractiveShellManager, TmuxCommandRunner, type CommandRunner } from "./shell-manager.js";

class FakeRunner implements CommandRunner {
	private readonly deferFirstSend: boolean;
	readonly calls: Array<{ args: string[]; stdin?: string }> = [];
	readonly livePanes = new Set<string>();
	readonly liveSessions = new Set<string>();
	private nextPane = 1;
	private deferredSendCount = 0;
	private releaseFirstSend: (() => void) | undefined;
	private deferredSendReady: (() => void) | undefined;
	readonly waitForDeferredSend = new Promise<void>((resolve) => {
		this.deferredSendReady = resolve;
	});
	readonly sendOrder: string[] = [];

	constructor(deferFirstSend = false) {
		this.deferFirstSend = deferFirstSend;
	}

	async run(
		args: string[],
		options: { stdin?: string } = {},
	): Promise<{ stdout: string; stderr: string }> {
		this.calls.push({ args, stdin: options.stdin });
		const command = args[0];

		if (command === "has-session") {
			const sessionName = args.at(-1)?.replace(/^=/, "") ?? "";
			if (!this.liveSessions.has(sessionName)) throw new Error("missing session");
			return { stdout: "", stderr: "" };
		}

		if (command === "new-session") {
			const sessionName = args[args.indexOf("-s") + 1];
			if (this.liveSessions.has(sessionName)) throw new Error("duplicate session");
			const paneId = `%${this.nextPane++}`;
			this.liveSessions.add(sessionName);
			this.livePanes.add(paneId);
			return { stdout: `${paneId}\n`, stderr: "" };
		}

		if (command === "display-message") {
			const paneId = args[args.indexOf("-t") + 1];
			if (!this.livePanes.has(paneId)) throw new Error("missing pane");
			return { stdout: `${paneId}\n`, stderr: "" };
		}

		if (command === "send-keys") {
			const value = args.at(-1) ?? "";
			this.sendOrder.push(value);
			if (value !== "C-u" && this.deferFirstSend && this.deferredSendCount++ === 0) {
				await new Promise<void>((resolve) => {
					this.releaseFirstSend = resolve;
					this.deferredSendReady?.();
				});
			}
			return { stdout: "", stderr: "" };
		}

		if (command === "load-buffer") return { stdout: "", stderr: "" };
		if (command === "paste-buffer") return { stdout: "", stderr: "" };

		return { stdout: "", stderr: "" };
	}

	releaseDeferredSend() {
		this.releaseFirstSend?.();
	}
}

function callArgs(runner: FakeRunner): string[][] {
	return runner.calls.map((call) => call.args);
}

describe("interactive-shell lifecycle", () => {
	it("keeps shells between replies and cleans up only session-scoped shells on shutdown", async () => {
		const runner = new FakeRunner();
		const run = vi
			.spyOn(TmuxCommandRunner.prototype, "run")
			.mockImplementation((args, options) => runner.run(args, options));
		const handlers = new Map<string, () => Promise<void>>();
		const registerTool = vi.fn();
		try {
			interactiveShell({
				on: (event: string, handler: () => Promise<void>) => handlers.set(event, handler),
				registerFlag: vi.fn(),
				registerCommand: vi.fn(),
				registerTool,
			} as any);
			const tool = registerTool.mock.calls[0][0];
			const execute = (params: object) =>
				tool.execute("test", params, undefined, undefined, { cwd: "/repo" });
			const scoped = await execute({ action: "spawn", shell: "bash" });
			const persistent = await execute({ action: "spawn", shell: "bash", persist: true });

			await handlers.get("agent_settled")?.();
			expect((await execute({ action: "list" })).details.shells).toEqual([
				scoped.details.shell,
				persistent.details.shell,
			]);
			expect(callArgs(runner).filter((args) => args[0] === "kill-session")).toEqual([]);

			await handlers.get("session_shutdown")?.();
			expect((await execute({ action: "list" })).details.shells).toEqual([
				persistent.details.shell,
			]);
			expect(callArgs(runner).filter((args) => args[0] === "kill-session")).toEqual([
				["kill-session", "-t", scoped.details.shell.sessionName],
			]);
		} finally {
			run.mockRestore();
		}
	});
});

describe("InteractiveShellManager", () => {
	it("spawns each shell in a new detached tmux session", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner, "/bin/fish");

		const first = await manager.spawn({ cwd: "/repo" });
		const second = await manager.spawn({ cwd: "/repo" });

		expect(first.id).toBe("%1");
		expect(second.id).toBe("%2");
		expect(first.name).toBe("shell 1");
		expect(second.name).toBe("shell 2");
		expect(first.sessionName).toBe("pi--shell-1");
		expect(second.sessionName).toBe("pi--shell-2");
		expect(callArgs(runner).filter((args) => args[0] === "new-session")).toEqual([
			[
				"new-session",
				"-d",
				"-s",
				"pi--shell-1",
				"-c",
				"/repo",
				"-P",
				"-F",
				"#{pane_id}",
				"/bin/fish",
			],
			[
				"new-session",
				"-d",
				"-s",
				"pi--shell-2",
				"-c",
				"/repo",
				"-P",
				"-F",
				"#{pane_id}",
				"/bin/fish",
			],
		]);
	});

	it("uses friendly names in records and tmux session names", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner, "/bin/fish");

		const shell = await manager.spawn({ cwd: "/repo", name: "Dev server" });

		expect(shell.name).toBe("Dev server");
		expect(shell.sessionName).toBe("pi--dev-server");
	});

	it("rejects a name whose tmux session is already active", async () => {
		const runner = new FakeRunner();
		runner.liveSessions.add("pi--dev-server");
		const manager = new InteractiveShellManager(runner, "/bin/fish");

		await expect(manager.spawn({ cwd: "/repo", name: "Dev server" })).rejects.toThrow(
			'interactive shell name "Dev server" is already active as tmux session "pi--dev-server"',
		);
		expect(callArgs(runner).filter((args) => args[0] === "new-session")).toEqual([]);
	});

	it.each([
		{ choice: undefined, shell: "/bin/fish", command: "/bin/fish" },
		{ choice: "bash" as const, shell: "bash", command: "bash --noprofile --norc" },
		{ choice: "zsh" as const, shell: "zsh", command: "zsh -f" },
	])("starts the selected $shell shell", async ({ choice, shell, command }) => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner, "/bin/fish");

		const record = await manager.spawn({ cwd: "/repo", shell: choice });
		const newSession = callArgs(runner).find((args) => args[0] === "new-session");

		expect(record.shell).toBe(shell);
		expect(record.shellChoice).toBe(choice ?? "user");
		expect(newSession?.at(-1)).toBe(command);
	});

	it("stops session-scoped shells while leaving persistent shells running", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner, "/bin/fish");
		const ephemeral = await manager.spawn({ cwd: "/repo" });
		const persistent = await manager.spawn({ cwd: "/repo", persist: true });
		runner.calls.length = 0;

		const killed = await manager.killNonPersistent();

		expect(killed).toEqual([ephemeral]);
		expect(callArgs(runner).filter((args) => args[0] === "kill-session")).toEqual([
			["kill-session", "-t", ephemeral.sessionName],
		]);
		expect(persistent.persist).toBe(true);
	});

	it("rejects friendly names longer than 80 characters", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner, "/bin/fish");

		await expect(manager.spawn({ cwd: "/repo", name: "x".repeat(81) })).rejects.toThrow(
			"interactive shell name must be 80 characters or fewer",
		);
	});

	it("serializes concurrent sends so text and submit stay paired", async () => {
		const runner = new FakeRunner(true);
		const manager = new InteractiveShellManager(runner, "/bin/fish");
		const shell = await manager.spawn({ cwd: "/repo" });
		runner.calls.length = 0;

		const first = manager.send({ shellId: shell.id, text: "one", submit: true });
		const second = manager.send({ shellId: shell.id, text: "two", submit: true });
		await runner.waitForDeferredSend;
		runner.releaseDeferredSend();
		await Promise.all([first, second]);

		expect(runner.sendOrder).toEqual(["C-u", "one", "Enter", "two", "Enter"]);
	});

	it("uses a paste buffer for multiline text", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner, "/bin/fish");
		const shell = await manager.spawn({ cwd: "/repo" });
		runner.calls.length = 0;

		await manager.send({ shellId: shell.id, text: "line1\nline2", submit: true });

		const calls = runner.calls;
		expect(calls[1]).toMatchObject({
			args: expect.arrayContaining(["load-buffer", "-b"]),
			stdin: "line1\nline2",
		});
		expect(calls[2].args).toEqual([
			"paste-buffer",
			"-b",
			calls[1].args[2],
			"-d",
			"-r",
			"-t",
			shell.id,
		]);
		expect(calls[3].args).toEqual(["send-keys", "-t", shell.id, "Enter"]);
	});
});

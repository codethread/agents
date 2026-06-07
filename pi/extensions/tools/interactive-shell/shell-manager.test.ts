import { describe, expect, it } from "vitest";
import { InteractiveShellManager, type CommandRunner } from "./shell-manager.js";

class FakeRunner implements CommandRunner {
	readonly calls: Array<{ args: string[]; stdin?: string }> = [];
	readonly livePanes = new Set<string>();
	private nextPane = 1;
	private deferredSendCount = 0;
	private releaseFirstSend: (() => void) | undefined;
	private deferredSendReady: (() => void) | undefined;
	readonly waitForDeferredSend = new Promise<void>((resolve) => {
		this.deferredSendReady = resolve;
	});
	readonly sendOrder: string[] = [];

	constructor(private readonly deferFirstSend = false) {}

	async run(
		args: string[],
		options: { stdin?: string } = {},
	): Promise<{ stdout: string; stderr: string }> {
		this.calls.push({ args, stdin: options.stdin });
		const command = args[0];

		if (command === "new-session") {
			const paneId = `%${this.nextPane++}`;
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

describe("InteractiveShellManager", () => {
	it("spawns each shell in a new detached tmux session", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner);

		const first = await manager.spawn("/repo", undefined);
		const second = await manager.spawn("/repo", undefined);

		expect(first.id).toBe("%1");
		expect(second.id).toBe("%2");
		expect(first.name).toBe("shell 1");
		expect(second.name).toBe("shell 2");
		expect(first.sessionName).toMatch(/^pi-interactive-shell-.*-shell-1$/);
		expect(second.sessionName).toMatch(/^pi-interactive-shell-.*-shell-2$/);
		expect(second.sessionName).not.toBe(first.sessionName);
		expect(callArgs(runner)[0]).toEqual([
			"new-session",
			"-d",
			"-s",
			first.sessionName,
			"-c",
			"/repo",
			"-P",
			"-F",
			"#{pane_id}",
		]);
		expect(callArgs(runner).filter((args) => args[0] === "new-session").at(-1)).toEqual([
			"new-session",
			"-d",
			"-s",
			second.sessionName,
			"-c",
			"/repo",
			"-P",
			"-F",
			"#{pane_id}",
		]);
	});

	it("uses friendly names in records and tmux session names", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner);

		const shell = await manager.spawn("/repo", "Dev server");

		expect(shell.name).toBe("Dev server");
		expect(shell.sessionName).toMatch(/^pi-interactive-shell-.*-dev-server$/);
	});

	it("rejects friendly names longer than 80 characters", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner);

		await expect(manager.spawn("/repo", "x".repeat(81))).rejects.toThrow(
			"interactive shell name must be 80 characters or fewer",
		);
	});

	it("serializes concurrent sends so text and submit stay paired", async () => {
		const runner = new FakeRunner(true);
		const manager = new InteractiveShellManager(runner);
		const shell = await manager.spawn("/repo", undefined);
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
		const manager = new InteractiveShellManager(runner);
		const shell = await manager.spawn("/repo", undefined);
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

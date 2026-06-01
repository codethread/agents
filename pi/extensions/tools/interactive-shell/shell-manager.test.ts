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

		if (command === "split-window") {
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
			if (this.deferFirstSend && this.deferredSendCount++ === 0) {
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
	it("spawns an empty inherited shell first on the right, then stacks later shells below", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner, "%root");

		const first = await manager.spawn("/repo");
		const second = await manager.spawn("/repo");

		expect(first.id).toBe("%1");
		expect(second.id).toBe("%2");
		expect(callArgs(runner)[0]).toEqual([
			"split-window",
			"-h",
			"-d",
			"-l",
			"40%",
			"-t",
			"%root",
			"-c",
			"/repo",
			"-P",
			"-F",
			"#{pane_id}",
		]);
		expect(callArgs(runner).at(-2)).toEqual([
			"split-window",
			"-v",
			"-d",
			"-t",
			"%1",
			"-c",
			"/repo",
			"-P",
			"-F",
			"#{pane_id}",
		]);
	});

	it("serializes concurrent sends so text and submit stay paired", async () => {
		const runner = new FakeRunner(true);
		const manager = new InteractiveShellManager(runner, "%root");
		const shell = await manager.spawn("/repo");
		runner.calls.length = 0;

		const first = manager.send({ shellId: shell.id, text: "one", submit: true });
		const second = manager.send({ shellId: shell.id, text: "two", submit: true });
		await runner.waitForDeferredSend;
		runner.releaseDeferredSend();
		await Promise.all([first, second]);

		expect(runner.sendOrder).toEqual(["one", "Enter", "two", "Enter"]);
	});

	it("uses a paste buffer for multiline text", async () => {
		const runner = new FakeRunner();
		const manager = new InteractiveShellManager(runner, "%root");
		const shell = await manager.spawn("/repo");
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

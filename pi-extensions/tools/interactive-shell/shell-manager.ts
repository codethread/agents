import { execFile } from "node:child_process";

export interface ShellRecord {
	id: string;
	paneId: string;
	cwd: string;
	startedAt: string;
	shell: string;
	shellEnv?: string;
}

interface RunOptions {
	cwd?: string;
	signal?: AbortSignal;
	stdin?: string;
}

interface CommandResult {
	stdout: string;
	stderr: string;
}

export interface CommandRunner {
	run(args: string[], options?: RunOptions): Promise<CommandResult>;
}

export class TmuxCommandRunner implements CommandRunner {
	run(args: string[], options: RunOptions = {}): Promise<CommandResult> {
		return new Promise((resolve, reject) => {
			const child = execFile(
				"tmux",
				args,
				{
					cwd: options.cwd,
					signal: options.signal,
					timeout: 5000,
					maxBuffer: 1024 * 1024,
				},
				(error, stdout, stderr) => {
					if (error) {
						reject(error);
						return;
					}
					resolve({ stdout, stderr });
				},
			);
			if (options.stdin !== undefined) child.stdin?.end(options.stdin);
		});
	}
}

export class InteractiveShellManager {
	private readonly shells = new Map<string, ShellRecord>();
	private latestId: string | undefined;
	private spawnQueue: Promise<void> = Promise.resolve();
	private sendQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly runner: CommandRunner,
		private readonly rootPaneId: string | undefined,
	) {}

	async spawn(cwd: string, signal?: AbortSignal): Promise<ShellRecord> {
		const previousSpawn = this.spawnQueue;
		let releaseSpawn!: () => void;
		this.spawnQueue = new Promise((resolve) => {
			releaseSpawn = resolve;
		});

		await previousSpawn;
		try {
			const liveShells = await this.list(signal);
			const latestLive = liveShells.at(-1);
			const args = latestLive
				? this.buildStackedSplitArgs(latestLive.paneId, cwd)
				: this.buildFirstSplitArgs(cwd);

			const result = await this.runner.run(args, { cwd, signal });
			const paneId = result.stdout.trim().split(/\s+/)[0];
			if (!paneId) throw new Error("interactive shell did not return a pane id");
			if (!(await this.isPaneLive(paneId, signal))) {
				throw new Error("interactive shell pane was not live after spawn");
			}

			const shellEnv = process.env.SHELL;
			const record: ShellRecord = {
				id: paneId,
				paneId,
				cwd,
				startedAt: new Date().toISOString(),
				shell: shellEnv ?? "default",
				shellEnv,
			};
			this.shells.set(record.id, record);
			this.latestId = record.id;
			return record;
		} finally {
			releaseSpawn();
		}
	}

	async list(signal?: AbortSignal): Promise<ShellRecord[]> {
		for (const record of [...this.shells.values()]) {
			const live = await this.isPaneLive(record.paneId, signal);
			if (!live) this.shells.delete(record.id);
		}
		this.refreshLatestId();
		return [...this.shells.values()];
	}

	async send(params: {
		shellId?: string;
		text?: string;
		submit?: boolean;
		signal?: AbortSignal;
	}): Promise<ShellRecord> {
		const previousSend = this.sendQueue;
		let releaseSend!: () => void;
		this.sendQueue = new Promise((resolve) => {
			releaseSend = resolve;
		});

		await previousSend;
		try {
			const target = await this.resolveTarget(params.shellId, params.signal);
			const hasText = params.text !== undefined && params.text.length > 0;
			const shouldSubmit = params.submit === true;

			if (!hasText && !shouldSubmit) {
				throw new Error("send requires text, submit, or both");
			}
			if (hasText) {
				await this.sendText(target.paneId, params.text!, params.signal);
			}
			if (shouldSubmit) {
				await this.runner.run(["send-keys", "-t", target.paneId, "Enter"], {
					signal: params.signal,
				});
			}
			this.latestId = target.id;
			return target;
		} finally {
			releaseSend();
		}
	}

	async tail(shellId: string | undefined, lines = 100, signal?: AbortSignal): Promise<string> {
		if (!Number.isInteger(lines) || lines < 1) {
			throw new Error("lines must be a positive integer");
		}
		const target = await this.resolveTarget(shellId, signal);
		const result = await this.runner.run(
			["capture-pane", "-J", "-t", target.paneId, "-p", "-S", `-${lines}`],
			{ signal },
		);
		this.latestId = target.id;
		return result.stdout;
	}

	async kill(shellId: string | undefined, signal?: AbortSignal): Promise<ShellRecord> {
		const target = await this.resolveTarget(shellId, signal);
		await this.runner.run(["kill-pane", "-t", target.paneId], { signal });
		this.shells.delete(target.id);
		this.refreshLatestId();
		return target;
	}

	private async sendText(
		paneId: string,
		text: string,
		signal: AbortSignal | undefined,
	): Promise<void> {
		if (!text.includes("\n") && !text.includes("\r")) {
			await this.runner.run(["send-keys", "-t", paneId, "-l", "--", text], { signal });
			return;
		}

		const bufferName = `pi-interactive-shell-${process.pid}-${Date.now()}`;
		await this.runner.run(["load-buffer", "-b", bufferName, "-"], { signal, stdin: text });
		await this.runner.run(["paste-buffer", "-b", bufferName, "-d", "-r", "-t", paneId], {
			signal,
		});
	}

	private buildFirstSplitArgs(cwd: string): string[] {
		return [
			"split-window",
			"-h",
			"-d",
			"-l",
			"40%",
			...(this.rootPaneId ? ["-t", this.rootPaneId] : []),
			"-c",
			cwd,
			"-P",
			"-F",
			"#{pane_id}",
		];
	}

	private buildStackedSplitArgs(targetPaneId: string, cwd: string): string[] {
		return ["split-window", "-v", "-d", "-t", targetPaneId, "-c", cwd, "-P", "-F", "#{pane_id}"];
	}

	private async resolveTarget(
		shellId: string | undefined,
		signal: AbortSignal | undefined,
	): Promise<ShellRecord> {
		await this.list(signal);
		const targetId = shellId ?? this.latestId;
		if (!targetId) throw new Error("no interactive shells are running");

		const target = this.shells.get(targetId);
		if (!target) throw new Error(`unknown interactive shell: ${targetId}`);
		return target;
	}

	private async isPaneLive(paneId: string, signal: AbortSignal | undefined): Promise<boolean> {
		try {
			const result = await this.runner.run(["display-message", "-p", "-t", paneId, "#{pane_id}"], {
				signal,
			});
			return result.stdout.trim() === paneId;
		} catch {
			return false;
		}
	}

	private refreshLatestId(): void {
		if (this.latestId && this.shells.has(this.latestId)) return;
		this.latestId = [...this.shells.keys()].at(-1);
	}
}

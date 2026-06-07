import { execFile } from "node:child_process";

export interface ShellRecord {
	id: string;
	paneId: string;
	sessionName: string;
	name: string;
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
	private nextSession = 1;

	constructor(private readonly runner: CommandRunner) {}

	async spawn(cwd: string, name: string | undefined, signal?: AbortSignal): Promise<ShellRecord> {
		const previousSpawn = this.spawnQueue;
		let releaseSpawn!: () => void;
		this.spawnQueue = new Promise((resolve) => {
			releaseSpawn = resolve;
		});

		await previousSpawn;
		try {
			await this.list(signal);
			const displayName = this.normalizeName(name);
			const sessionName = this.buildSessionName(displayName);
			const result = await this.runner.run(this.buildNewSessionArgs(sessionName, cwd), { cwd, signal });
			const paneId = result.stdout.trim().split(/\s+/)[0];
			if (!paneId) throw new Error("interactive shell did not return a pane id");
			if (!(await this.isPaneLive(paneId, signal))) {
				throw new Error("interactive shell pane was not live after spawn");
			}
			await this.prepareNewPane(paneId, signal);

			const shellEnv = process.env.SHELL;
			const record: ShellRecord = {
				id: paneId,
				paneId,
				sessionName,
				name: displayName,
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
		await this.runner.run(["kill-session", "-t", target.sessionName], { signal });
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

	private async prepareNewPane(
		paneId: string,
		signal: AbortSignal | undefined,
	): Promise<void> {
		await this.runner.run(["send-keys", "-t", paneId, "C-u"], { signal });
		await this.runner.run(["clear-history", "-t", paneId], { signal });
	}

	private buildNewSessionArgs(sessionName: string, cwd: string): string[] {
		return [
			"new-session",
			"-d",
			"-s",
			sessionName,
			"-c",
			cwd,
			"-P",
			"-F",
			"#{pane_id}",
		];
	}

	private buildSessionName(displayName: string): string {
		const suffix = this.slugifyName(displayName);
		return `pi-interactive-shell-${process.pid}-${Date.now()}-${this.nextSession++}-${suffix}`;
	}

	private normalizeName(name: string | undefined): string {
		const trimmed = name?.trim();
		if (!trimmed) return `shell ${this.nextSession}`;
		if (trimmed.length > 80) {
			throw new Error("interactive shell name must be 80 characters or fewer");
		}
		return trimmed;
	}

	private slugifyName(name: string): string {
		const slug = name
			.toLowerCase()
			.replaceAll(/[^a-z0-9_-]+/g, "-")
			.replaceAll(/^-|-$/g, "")
			.slice(0, 32);
		return slug || "shell";
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

import { execFile } from "node:child_process";
import { PrivateTmuxServer, type PrivateServer } from "./private-server.js";

export type ShellChoice = "user" | "bash" | "zsh";

export interface ShellRecord {
	id: string;
	paneId: string;
	/** "default" for shared shells, otherwise the private socket path. */
	server: string;
	sessionName: string;
	name: string;
	cwd: string;
	startedAt: string;
	shell: string;
	shellChoice: ShellChoice;
	persist: boolean;
	shellEnv?: string;
}

export interface SpawnOptions {
	cwd: string;
	name?: string;
	shell?: ShellChoice;
	persist?: boolean;
	signal?: AbortSignal;
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

export function tmuxServerArgs(server: string): string[] {
	// -N prevents an in-flight command from recreating a private server during cleanup.
	return server === "default" ? ["-L", "default"] : ["-N", "-S", server];
}

export class InteractiveShellManager {
	private readonly runner: CommandRunner;
	private readonly userShell: string | undefined;
	private readonly privateServer: PrivateServer;
	private readonly shells = new Map<string, ShellRecord>();
	private latestId: string | undefined;
	private spawnQueue: Promise<void> = Promise.resolve();
	private sendQueue: Promise<void> = Promise.resolve();
	private nextSession = 1;
	private closed = false;

	constructor(
		runner: CommandRunner,
		userShell = process.env.SHELL,
		privateServer: PrivateServer = new PrivateTmuxServer(),
	) {
		this.runner = runner;
		this.userShell = userShell;
		this.privateServer = privateServer;
	}

	async spawn(options: SpawnOptions): Promise<ShellRecord> {
		const previousSpawn = this.spawnQueue;
		let releaseSpawn!: () => void;
		this.spawnQueue = new Promise((resolve) => {
			releaseSpawn = resolve;
		});

		await previousSpawn;
		try {
			if (this.closed) throw new Error("interactive shell manager is shut down");
			await this.list(options.signal);
			const displayName = this.normalizeName(options.name);
			const sessionName = this.buildSessionName(displayName);
			const sequence = this.nextSession++;
			const server = options.persist ? "default" : await this.privateServer.getSocketPath();
			if (await this.isSessionLive(server, sessionName, options.signal)) {
				throw this.sessionAlreadyActiveError(displayName, sessionName);
			}
			const shellChoice = options.shell ?? "user";
			const shellEnv = this.userShell;
			const shell = shellChoice === "user" ? shellEnv : shellChoice;
			if (!shell) throw new Error("SHELL is not set; choose bash or zsh explicitly");

			let result: CommandResult;
			try {
				result = await this.run(
					server,
					this.buildNewSessionArgs(sessionName, options.cwd, shellChoice, shell),
					{
						cwd: options.cwd,
						signal: options.signal,
					},
				);
			} catch (error) {
				if (await this.isSessionLive(server, sessionName, options.signal)) {
					throw this.sessionAlreadyActiveError(displayName, sessionName);
				}
				throw error;
			}
			const paneId = result.stdout.trim().split(/\s+/)[0];
			if (!paneId) throw new Error("interactive shell did not return a pane id");
			if (!(await this.isPaneLive(server, paneId, options.signal))) {
				throw new Error("interactive shell pane was not live after spawn");
			}
			await this.prepareNewPane(server, paneId, options.signal);

			const record: ShellRecord = {
				id: `shell-${sequence}`,
				paneId,
				server,
				sessionName,
				name: displayName,
				cwd: options.cwd,
				startedAt: new Date().toISOString(),
				shell,
				shellChoice,
				persist: options.persist ?? false,
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
			const live = await this.isPaneLive(record.server, record.paneId, signal);
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
				await this.sendText(target.server, target.paneId, params.text!, params.signal);
			}
			if (shouldSubmit) {
				await this.run(target.server, ["send-keys", "-t", target.paneId, "Enter"], {
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
		const result = await this.run(
			target.server,
			["capture-pane", "-J", "-t", target.paneId, "-p", "-S", `-${lines}`],
			{ signal },
		);
		this.latestId = target.id;
		return result.stdout;
	}

	async kill(shellId: string | undefined, signal?: AbortSignal): Promise<ShellRecord> {
		const target = await this.resolveTarget(shellId, signal);
		await this.run(target.server, ["kill-session", "-t", `=${target.sessionName}`], { signal });
		this.shells.delete(target.id);
		this.refreshLatestId();
		return target;
	}

	async shutdown(): Promise<void> {
		this.closed = true;
		await this.spawnQueue;
		await this.privateServer.dispose();
		for (const record of this.shells.values()) {
			if (!record.persist) this.shells.delete(record.id);
		}
		this.refreshLatestId();
	}

	private run(server: string, args: string[], options?: RunOptions): Promise<CommandResult> {
		return this.runner.run([...tmuxServerArgs(server), ...args], options);
	}

	private async sendText(
		server: string,
		paneId: string,
		text: string,
		signal: AbortSignal | undefined,
	): Promise<void> {
		if (!text.includes("\n") && !text.includes("\r")) {
			await this.run(server, ["send-keys", "-t", paneId, "-l", "--", text], { signal });
			return;
		}

		const bufferName = `pi-interactive-shell-${process.pid}-${Date.now()}`;
		await this.run(server, ["load-buffer", "-b", bufferName, "-"], { signal, stdin: text });
		await this.run(server, ["paste-buffer", "-b", bufferName, "-d", "-r", "-t", paneId], {
			signal,
		});
	}

	private async prepareNewPane(
		server: string,
		paneId: string,
		signal: AbortSignal | undefined,
	): Promise<void> {
		await this.run(server, ["send-keys", "-t", paneId, "C-u"], { signal });
		await this.run(server, ["clear-history", "-t", paneId], { signal });
	}

	private buildNewSessionArgs(
		sessionName: string,
		cwd: string,
		shellChoice: ShellChoice,
		shell: string,
	): string[] {
		const args = ["new-session", "-d", "-s", sessionName, "-c", cwd, "-P", "-F", "#{pane_id}"];
		if (shellChoice === "user") args.push(shell);
		if (shellChoice === "bash") args.push("bash --noprofile --norc");
		if (shellChoice === "zsh") args.push("zsh -f");
		return args;
	}

	private buildSessionName(displayName: string): string {
		return `pi--${this.slugifyName(displayName)}`;
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
			.replaceAll(/^-|-$/g, "");
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

	private async isPaneLive(
		server: string,
		paneId: string,
		signal: AbortSignal | undefined,
	): Promise<boolean> {
		try {
			const result = await this.run(server, ["display-message", "-p", "-t", paneId, "#{pane_id}"], {
				signal,
			});
			return result.stdout.trim() === paneId;
		} catch {
			return false;
		}
	}

	private async isSessionLive(
		server: string,
		sessionName: string,
		signal: AbortSignal | undefined,
	): Promise<boolean> {
		try {
			await this.run(server, ["has-session", "-t", `=${sessionName}`], { signal });
			return true;
		} catch {
			return false;
		}
	}

	private sessionAlreadyActiveError(displayName: string, sessionName: string): Error {
		return new Error(
			`interactive shell name "${displayName}" is already active as tmux session "${sessionName}"`,
		);
	}

	private refreshLatestId(): void {
		if (this.latestId && this.shells.has(this.latestId)) return;
		this.latestId = [...this.shells.keys()].at(-1);
	}
}

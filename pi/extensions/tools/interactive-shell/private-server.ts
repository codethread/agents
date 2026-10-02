import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface PrivateServer {
	getSocketPath(): Promise<string>;
	dispose(): Promise<void>;
}

/** One lease per extension runtime, including concurrent runtimes in Pies. */
export class PrivateTmuxServer implements PrivateServer {
	private child?: ChildProcess;
	private ready?: Promise<string>;
	private exited?: Promise<number | null>;
	private closed = false;

	getSocketPath(): Promise<string> {
		if (this.closed) return Promise.reject(new Error("interactive shell server is shut down"));
		if (this.ready) return this.ready;

		const child = spawn(
			process.execPath,
			[fileURLToPath(new URL("./server-supervisor.mjs", import.meta.url))],
			{ detached: true, stdio: ["ignore", "ignore", "inherit", "ipc"] },
		);
		this.child = child;
		this.exited = new Promise((resolve) => {
			child.once("exit", resolve);
			child.once("error", () => resolve(1));
		});
		this.ready = new Promise<string>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code, signal) => {
				reject(new Error(`interactive shell supervisor exited (${signal ?? code})`));
			});
			child.once("message", (message: unknown) => {
				if (
					typeof message !== "object" ||
					message === null ||
					!("socketPath" in message) ||
					typeof message.socketPath !== "string"
				) {
					reject(new Error("invalid interactive shell supervisor response"));
					if (child.connected) child.disconnect();
					return;
				}
				if (!this.closed) {
					child.unref();
					child.channel?.unref();
				}
				resolve(message.socketPath);
			});
		});
		// The lease must not keep Pi alive. IPC closure still notifies the detached
		// supervisor on normal exit, a crash, or SIGKILL (without PID polling).
		return this.ready;
	}

	async dispose(): Promise<void> {
		this.closed = true;
		if (!this.child) return;
		this.child.ref();
		if (this.child.connected) this.child.disconnect();
		const code = await this.exited;
		if (code !== 0) throw new Error(`interactive shell cleanup failed (${code})`);
	}
}

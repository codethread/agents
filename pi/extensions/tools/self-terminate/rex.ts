import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const processSchema = z.object({ pid: z.number().int() });
const rexProcessesSchema = z.object({
	child: processSchema.nullish(),
	foreground: processSchema.nullish(),
	ancestors: z.array(processSchema).nullish(),
});
const rexBlocksSchema = z.object({
	blocks: z.array(
		z.object({
			block_id: z.string().min(1),
			window_id: z.string().min(1).optional(),
		}),
	),
});

export interface RexWindow {
	/** Session inherited from Rex, never selected from app focus. */
	sessionId: string;
	/** Terminal block whose process tree contains Pi. */
	blockId: string;
	/** Tab containing only that block. */
	windowId: string;
}

export type RexPlan = { kind: "close"; window: RexWindow } | { kind: "skip"; reason: string };

export async function inspectRexWindow(env: NodeJS.ProcessEnv, pid: number): Promise<RexPlan> {
	if (!env.REX_SESSION || !env.REX_BLOCK) {
		return { kind: "skip", reason: "not running in an identified Rex terminal" };
	}
	const sessionId = env.REX_SESSION;
	const blockId = env.REX_BLOCK;
	try {
		const processes = rexProcessesSchema.parse(
			await rexJson(["block", "call", "-s", sessionId, "-b", blockId, "process"], env),
		);
		const pids = [processes.child, processes.foreground, ...(processes.ancestors ?? [])];
		if (!pids.some((entry) => entry?.pid === pid)) {
			return { kind: "skip", reason: "Pi is not in the inherited Rex block's process tree" };
		}
		const { blocks } = rexBlocksSchema.parse(
			await rexJson(["block", "ls", "-s", sessionId, "--json"], env),
		);
		const block = blocks.find((entry) => entry.block_id === blockId);
		if (!block?.window_id) {
			return { kind: "skip", reason: "Rex block has no window" };
		}
		if (blocks.filter((entry) => entry.window_id === block.window_id).length !== 1) {
			return { kind: "skip", reason: "Rex tab contains other panes" };
		}
		return { kind: "close", window: { sessionId, blockId, windowId: block.window_id } };
	} catch (error) {
		// Rex cleanup is optional; report its failure without preventing Pi shutdown.
		return {
			kind: "skip",
			reason: `Rex detection failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export async function scheduleRexClose(window: RexWindow): Promise<string> {
	const logPath = join(tmpdir(), `pi-self-terminate-${process.pid}.log`);
	const log = openSync(logPath, "a", 0o600);
	try {
		const child = spawn(
			"node",
			[fileURLToPath(new URL("./rex-close.mjs", import.meta.url)), JSON.stringify(window)],
			{
				detached: true,
				serialization: "json",
				cwd: tmpdir(),
				stdio: ["ignore", log, log, "ipc"],
			},
		);
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code, signal) =>
				reject(new Error(`Rex cleanup helper exited (${signal ?? code}); see ${logPath}`)),
			);
			child.once("message", () => {
				// IPC stays open until process exit, not merely session_shutdown. Neither
				// handle keeps Pi alive; the detached helper survives its parent and tty.
				child.unref();
				// Bun's child.unref() covers IPC; only Node exposes channel.unref().
				child.channel?.unref?.();
				resolve();
			});
		});
		return logPath;
	} finally {
		closeSync(log);
	}
}

// ---------------------------------------------------------------------------

async function rexJson(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
	const { stdout } = await execFileAsync("rex", ["--autostart=false", "--timeout", "3s", ...args], {
		env,
		timeout: 5000,
		maxBuffer: 1024 * 1024,
	});
	return JSON.parse(stdout);
}

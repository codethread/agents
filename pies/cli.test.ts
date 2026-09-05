import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LineDecoder, writeFrame } from "./protocol.ts";

describe("headless client cancellation", () => {
	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
		["SIGHUP", 129],
	] as const)("waits for cleanup after repeated %s, then exits %i", async (signal, code) => {
		const directory = await mkdtemp(join(tmpdir(), "pies-signals-"));
		const socketPath = join(directory, "daemon.sock");
		let socket: Socket | undefined;
		const server = createServer();
		server.listen(socketPath);
		await once(server, "listening");
		const connection = once(server, "connection");
		const child = spawn(
			process.execPath,
			["--experimental-strip-types", fileURLToPath(new URL("./cli.ts", import.meta.url)), "ping"],
			{ env: { ...process.env, PIES_SOCKET: socketPath }, stdio: ["ignore", "pipe", "pipe"] },
		);
		const exited = once(child, "exit");
		try {
			[socket] = (await connection) as [Socket];
			const decoder = new LineDecoder();
			const cancelled = new Promise<string>((resolve) => {
				socket!.on("data", (chunk: Buffer) => {
					for (const raw of decoder.push(chunk)) {
						const frame = raw as { type: string; id: string };
						if (frame.type === "run") child.kill(signal);
						if (frame.type === "cancel") resolve(frame.id);
					}
				});
			});
			const id = await cancelled;
			child.kill(signal);
			const output = once(child.stdout!, "data");
			writeFrame(socket, { type: "stdout", id, data: "cleanup pending\n" });
			expect(String((await output)[0])).toBe("cleanup pending\n");
			expect(child.exitCode).toBeNull();
			writeFrame(socket, { type: "result", id, exitCode: 130 });
			socket.end();
			expect(await exited).toEqual([code, null]);
		} finally {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
				await exited;
			}
			socket?.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await rm(directory, { recursive: true, force: true });
		}
	});
});

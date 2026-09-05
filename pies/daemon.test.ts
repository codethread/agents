import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { encodeFrame, LineDecoder, PROTOCOL_VERSION } from "./protocol.ts";

it("retains cancellation during initialization and releases the request before acknowledging", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pies-init-cancel-"));
	const socketPath = join(directory, "daemon.sock");
	const daemon = spawn(
		process.execPath,
		[
			"--experimental-strip-types",
			fileURLToPath(new URL("./daemon.ts", import.meta.url)),
			"--socket",
			socketPath,
		],
		{
			env: { ...process.env, PIES_SOCKET: socketPath },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const exited = once(daemon, "exit");
	let socket: Socket | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			daemon.stdout!.on("data", (chunk: Buffer) => {
				if (chunk.toString().includes("listening")) resolve();
			});
			daemon.once("exit", () => reject(new Error("Disposable daemon exited before listening")));
		});
		socket = createConnection(socketPath);
		await once(socket, "connect");
		const decoder = new LineDecoder();
		const output: string[] = [];
		const result = new Promise<{
			exitCode: number;
			status: { activeRequests: number; activeSessions: number };
		}>((resolve) => {
			socket!.on("data", (chunk: Buffer) => {
				for (const raw of decoder.push(chunk)) {
					const frame = raw as {
						type: string;
						data: string;
						exitCode: number;
						status: { activeRequests: number; activeSessions: number };
					};
					if (frame.type === "stdout") output.push(frame.data);
					if (frame.type === "result") resolve(frame);
				}
			});
		});
		const id = "cancel-during-initialization";
		socket.write(
			encodeFrame({
				protocol: PROTOCOL_VERSION,
				type: "run",
				id,
				cwd: directory,
				env: {
					PATH: process.env.PATH,
					HOME: directory,
					PIES_LOG_FILE: join(directory, "invocations.jsonl"),
				},
				args: ["--no-extensions", "--no-session", "--mode", "json", "never submit this prompt"],
			}) + encodeFrame({ protocol: PROTOCOL_VERSION, type: "cancel", id }),
		);
		expect(await result).toMatchObject({
			exitCode: 130,
			status: { activeRequests: 0, activeSessions: 0 },
		});
		expect(output.join("")).not.toContain('"type":"agent_start"');
	} finally {
		socket?.destroy();
		daemon.kill("SIGTERM");
		await exited;
		await rm(directory, { recursive: true, force: true });
	}
}, 15000);

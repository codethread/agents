#!/usr/bin/env -S node --experimental-strip-types

import { closeSync, mkdirSync, openSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
	defaultSocketPath,
	isProtocolMismatchFrame,
	LineDecoder,
	PROTOCOL_VERSION,
	writeFrame,
} from "./protocol.ts";
import { invocationLogPath } from "./invocation-log.ts";

const PREVIOUS_PROTOCOL_VERSION = 4;
const clientPath = fileURLToPath(import.meta.url);
type Environment = Record<string, string>;
type DaemonStatus = {
	pid: number;
	piSdkVersion: string;
	activeRequests: number;
	activeSessions: number;
	memory: { rssBytes: number; heapUsedBytes: number };
	processListeners: { exit: number; max: number };
	uptimeSeconds: number;
	socketPath: string;
};
type ControlResponse = { type: "status" | "result"; id: string; status: DaemonStatus };
type StreamResponse =
	| { type: "stdout" | "stderr"; id: string; data: string }
	| { type: "result"; id: string; exitCode: number };

class IncompatibleDaemonError extends Error {
	code = "PIES_PROTOCOL_MISMATCH";

	constructor(socketPath: string) {
		super(
			[
				`An incompatible pies daemon is running at ${socketPath} (client protocol ${PROTOCOL_VERSION}).`,
				"Stop it, then retry:",
				`  ${process.execPath} --experimental-strip-types ${clientPath} daemon stop`,
			].join("\n"),
		);
	}
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
		? error.code
		: undefined;
}

function extractSocket(args: string[]): { socketPath: string; args: string[] } {
	const remaining: string[] = [];
	let socketPath = defaultSocketPath();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--socket") {
			if (!args[index + 1]) throw new Error("--socket requires a path");
			socketPath = args[index + 1];
			index += 1;
		} else if (arg.startsWith("--socket=")) socketPath = arg.slice("--socket=".length);
		else remaining.push(arg);
	}
	return { socketPath, args: remaining };
}

function connect(socketPath: string): Promise<Socket> {
	return new Promise((resolveConnect, reject) => {
		const socket = createConnection(socketPath);
		socket.once("connect", () => resolveConnect(socket));
		socket.once("error", reject);
	});
}

function environmentSnapshot(env: NodeJS.ProcessEnv = process.env): Environment {
	return Object.fromEntries(
		Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}

async function readStdin(): Promise<string | undefined> {
	if (process.stdin.isTTY) return undefined;
	let content = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) content += chunk;
	return content || undefined;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function startDaemon(socketPath: string): Promise<string> {
	mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
	const daemonPath = fileURLToPath(new URL("./daemon.ts", import.meta.url));
	const logPath = `${socketPath}.log`;
	const log = openSync(logPath, "a", 0o600);
	try {
		const child = spawn(
			process.execPath,
			["--experimental-strip-types", daemonPath, "--socket", socketPath],
			{
				cwd: process.cwd(),
				detached: true,
				env: { ...environmentSnapshot(), PIES_SOCKET: socketPath },
				stdio: ["ignore", log, log],
			},
		);
		child.unref();
	} finally {
		closeSync(log);
	}

	let lastError: unknown;
	for (let attempt = 0; attempt < 120; attempt += 1) {
		try {
			const socket = await connect(socketPath);
			socket.destroy();
			return logPath;
		} catch (error) {
			lastError = error;
			await delay(25);
		}
	}
	const detail = lastError instanceof Error ? lastError.message : "unknown error";
	throw new Error(`pies daemon did not start (${detail}); see ${logPath}`);
}

async function connectOrStart(socketPath: string): Promise<Socket> {
	try {
		return await connect(socketPath);
	} catch (error) {
		if (!["ENOENT", "ECONNREFUSED"].includes(errorCode(error) ?? "")) throw error;
		await startDaemon(socketPath);
		return connect(socketPath);
	}
}

function isControlResponse(message: unknown, id: string): message is ControlResponse {
	if (!message || typeof message !== "object") return false;
	const frame = message as Record<string, unknown>;
	return (
		frame.id === id &&
		(frame.type === "status" || frame.type === "result") &&
		!!frame.status &&
		typeof frame.status === "object"
	);
}

async function sendControl(
	socketPath: string,
	type: "status" | "stop",
	autoStart: boolean,
	protocol = PROTOCOL_VERSION,
): Promise<ControlResponse> {
	const socket = autoStart ? await connectOrStart(socketPath) : await connect(socketPath);
	return new Promise((resolveControl, reject) => {
		const id = randomUUID();
		const decoder = new LineDecoder();
		let completed = false;
		socket.on("data", (chunk: Buffer) => {
			try {
				for (const message of decoder.push(chunk)) {
					if (isProtocolMismatchFrame(message)) {
						completed = true;
						socket.destroy();
						reject(new IncompatibleDaemonError(socketPath));
						return;
					}
					if (isControlResponse(message, id)) {
						completed = true;
						resolveControl(message);
					}
				}
			} catch (error) {
				completed = true;
				reject(error);
			}
		});
		socket.once("error", reject);
		socket.once("close", () => {
			if (!completed) reject(new Error("pies daemon disconnected before returning a response"));
		});
		writeFrame(socket, { protocol, type, id });
	});
}

function formatBytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function printStatus(status: DaemonStatus): void {
	process.stdout.write(
		[
			`pid: ${status.pid}`,
			`Pi SDK: ${status.piSdkVersion}`,
			`active: ${status.activeRequests}`,
			`session leases: ${status.activeSessions}`,
			`rss: ${formatBytes(status.memory.rssBytes)}`,
			`heap used: ${formatBytes(status.memory.heapUsedBytes)}`,
			`process exit listeners: ${status.processListeners.exit}`,
			`process listener limit: ${status.processListeners.max === 0 ? "unlimited" : status.processListeners.max}`,
			`uptime: ${status.uptimeSeconds}s`,
			`socket: ${status.socketPath}`,
		].join("\n") + "\n",
	);
}

function isStreamResponse(message: unknown, id: string): message is StreamResponse {
	if (!message || typeof message !== "object") return false;
	const frame = message as Record<string, unknown>;
	return (
		frame.id === id &&
		((typeof frame.data === "string" && (frame.type === "stdout" || frame.type === "stderr")) ||
			(typeof frame.exitCode === "number" && frame.type === "result"))
	);
}

async function run(socketPath: string, args: string[]): Promise<number> {
	const socket = await connectOrStart(socketPath);
	const id = randomUUID();
	const decoder = new LineDecoder();
	let completed = false;
	let interrupted = false;
	const result = new Promise<number>((resolveResult, reject) => {
		socket.on("data", (chunk: Buffer) => {
			try {
				for (const message of decoder.push(chunk)) {
					if (isProtocolMismatchFrame(message)) {
						completed = true;
						reject(new IncompatibleDaemonError(socketPath));
						return;
					}
					if (!isStreamResponse(message, id)) continue;
					if (message.type === "stdout") process.stdout.write(message.data);
					else if (message.type === "stderr") process.stderr.write(message.data);
					else if (message.type === "result") {
						completed = true;
						resolveResult(message.exitCode);
					}
				}
			} catch (error) {
				reject(error);
			}
		});
		socket.once("error", reject);
		socket.once("close", () => {
			if (!completed) reject(new Error("pies daemon disconnected before returning a result"));
		});
	});
	const onInterrupt = (): void => {
		if (interrupted) {
			socket.destroy();
			process.exitCode = 130;
			return;
		}
		interrupted = true;
		writeFrame(socket, { protocol: PROTOCOL_VERSION, type: "cancel", id });
	};
	process.on("SIGINT", onInterrupt);
	try {
		writeFrame(socket, {
			protocol: PROTOCOL_VERSION,
			type: "run",
			id,
			cwd: process.cwd(),
			env: environmentSnapshot(),
			args,
			stdin: await readStdin(),
		});
		return await result;
	} finally {
		process.off("SIGINT", onInterrupt);
		socket.destroy();
	}
}

async function main(): Promise<number> {
	const extracted = extractSocket(process.argv.slice(2));
	const [first, second] = extracted.args;
	if (first === "--logfile") {
		process.stdout.write(`${invocationLogPath(environmentSnapshot(), process.cwd())}\n`);
		return 0;
	}
	if (first === "--debug-pies") {
		const response = await sendControl(extracted.socketPath, "status", false);
		printStatus(response.status);
		return 0;
	}
	if (first === "daemon") {
		const command = second ?? "status";
		if (command === "start") {
			await startDaemon(extracted.socketPath);
			const response = await sendControl(extracted.socketPath, "status", false);
			printStatus(response.status);
			return 0;
		}
		if (command === "status") {
			const response = await sendControl(extracted.socketPath, "status", false);
			printStatus(response.status);
			return 0;
		}
		if (command === "stop") {
			try {
				await sendControl(extracted.socketPath, "stop", false);
			} catch (error) {
				if (errorCode(error) !== "PIES_PROTOCOL_MISMATCH") throw error;
				await sendControl(extracted.socketPath, "stop", false, PREVIOUS_PROTOCOL_VERSION);
			}
			process.stdout.write("pies daemon stopped\n");
			return 0;
		}
		throw new Error(`Unknown daemon command: ${command}`);
	}
	return run(extracted.socketPath, extracted.args);
}

try {
	process.exitCode = await main();
} catch (error) {
	if (["ENOENT", "ECONNREFUSED"].includes(errorCode(error) ?? ""))
		console.error("pies daemon is not running");
	else console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}

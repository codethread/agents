#!/usr/bin/env -S node --experimental-strip-types

import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { argvForExtensions } from "./args.ts";
import {
	appendInvocationRecord,
	invocationLogPath,
	redactArgs,
	redactEnvironment,
	type InvocationRecord,
} from "./invocation-log.ts";
import {
	defaultSocketPath,
	LineDecoder,
	parseClientMessage,
	PROTOCOL_VERSION,
	writeFrame,
	type RunRequest,
} from "./protocol.ts";
import {
	bindRequestContext,
	createRequestEnvironment,
	installProcessRouting,
	runInRequestContext,
} from "./request-context.ts";
import { runPiRequest } from "./runner.ts";
import { SessionLeaseRegistry } from "./session-leases.ts";

process.title = "pies-daemon";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
process.env.PIES_DAEMON = "1";
installProcessRouting();

type AbortHandler = () => void;
type ActiveRequest = { abort: AbortHandler | undefined; done: Promise<unknown> };
type ResultMetadata = Record<string, unknown>;
type DaemonStatus = {
	pid: number;
	piSdkVersion: string;
	protocol: number;
	uptimeSeconds: number;
	activeRequests: number;
	activeSessions: number;
	memory: { rssBytes: number; heapUsedBytes: number; externalBytes: number };
	processListeners: { exit: number; max: number };
	socketPath: string;
};

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
		? error.code
		: undefined;
}

function socketFromArgs(args: string[]): string {
	const index = args.indexOf("--socket");
	return index !== -1 && args[index + 1] ? args[index + 1] : defaultSocketPath();
}

const socketPath = socketFromArgs(process.argv.slice(2));
const active = new Map<string, ActiveRequest>();
const sessionLeases = new SessionLeaseRegistry();
let shuttingDown = false;

function statusPayload(): DaemonStatus {
	const memory = process.memoryUsage();
	return {
		pid: process.pid,
		piSdkVersion: VERSION,
		protocol: PROTOCOL_VERSION,
		uptimeSeconds: Math.round(process.uptime()),
		activeRequests: active.size,
		activeSessions: sessionLeases.size,
		memory: {
			rssBytes: memory.rss,
			heapUsedBytes: memory.heapUsed,
			externalBytes: memory.external,
		},
		processListeners: { exit: process.listenerCount("exit"), max: process.getMaxListeners() },
		socketPath,
	};
}

function probeSocket(path: string): Promise<boolean> {
	return new Promise((resolveProbe) => {
		const socket = createConnection(path);
		let settled = false;
		const finish = (connected: boolean): void => {
			if (!settled) {
				settled = true;
				socket.destroy();
				resolveProbe(connected);
			}
		};
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		setTimeout(() => finish(false), 200).unref();
	});
}

async function prepareSocket(path: string): Promise<boolean> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	try {
		const entry = await lstat(path);
		if (await probeSocket(path)) return false;
		if (!entry.isSocket()) throw new Error(`Refusing to replace non-socket path: ${path}`);
		await unlink(path);
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}
	return true;
}

function send(socket: Socket, message: unknown): boolean {
	return socket.destroyed || !socket.writable ? false : writeFrame(socket, message);
}

function handleConnection(socket: Socket): void {
	const decoder = new LineDecoder();
	let ownedRequestId: string | undefined;
	let completed = false;
	const fail = (id: string, error: unknown): void => {
		send(socket, {
			type: "stderr",
			id,
			data: `${error instanceof Error ? error.message : String(error)}\n`,
		});
		send(socket, { type: "result", id, exitCode: 1 });
		completed = true;
		socket.end();
	};
	const startRun = (request: RunRequest): void => {
		if (ownedRequestId)
			return fail(request.id, new Error("Each connection may start only one run"));
		if (active.has(request.id))
			return fail(request.id, new Error(`Duplicate request id: ${request.id}`));
		ownedRequestId = request.id;
		let abort: AbortHandler | undefined;
		let requestedExitCode: number | undefined;
		let resultMetadata: ResultMetadata | undefined;
		const startedAt = Date.now();
		const logPath = invocationLogPath(request.env, request.cwd);
		const io = {
			write(stream: "stdout" | "stderr", data: string): boolean {
				return send(socket, { type: stream, id: request.id, data });
			},
			setAbort(handler: AbortHandler | undefined): void {
				abort = handler ? bindRequestContext(handler) : undefined;
				const entry = active.get(request.id);
				if (entry) entry.abort = abort;
			},
			setResultMetadata(metadata: ResultMetadata): void {
				resultMetadata = metadata;
			},
			claimSession(sessionId: string): void {
				sessionLeases.claim(sessionId, request.id);
			},
			requestExit(code: number): void {
				requestedExitCode ??= Number.isInteger(code) ? code : 0;
				abort?.();
			},
			exitRequested: (): boolean => requestedExitCode !== undefined,
			exitCode: (): number => requestedExitCode ?? 0,
		};
		const context = {
			cwd: request.cwd,
			env: createRequestEnvironment(request.env, socketPath),
			argv: argvForExtensions(request.args),
			write: io.write,
			requestExit: io.requestExit,
		};
		const done = runInRequestContext(context, async (): Promise<void> => {
			let exitCode = 1;
			let failure: string | undefined;
			const log = async (record: InvocationRecord): Promise<boolean> => {
				try {
					await appendInvocationRecord(logPath, record);
					return true;
				} catch (error) {
					io.write(
						"stderr",
						`Warning: unable to write pies invocation log at ${logPath}: ${error instanceof Error ? error.message : String(error)}\n`,
					);
					return false;
				}
			};
			try {
				await log({
					schemaVersion: 1,
					event: "invocation.started",
					timestamp: new Date(startedAt).toISOString(),
					requestId: request.id,
					pid: process.pid,
					cwd: request.cwd,
					args: redactArgs(request.args),
					env: redactEnvironment(request.env),
				});
				exitCode = await runPiRequest(request, io);
			} catch (error) {
				failure = error instanceof Error ? error.message : String(error);
				io.write("stderr", `${failure}\n`);
			} finally {
				const returnedExitCode = io.exitRequested() ? io.exitCode() : exitCode;
				sessionLeases.release(request.id);
				await log({
					schemaVersion: 1,
					event: "invocation.finished",
					timestamp: new Date().toISOString(),
					requestId: request.id,
					durationMs: Date.now() - startedAt,
					result: {
						exitCode: returnedExitCode,
						...(failure ? { error: failure } : {}),
						...resultMetadata,
					},
				});
				active.delete(request.id);
				completed = true;
				send(socket, {
					type: "result",
					id: request.id,
					exitCode: returnedExitCode,
					status: statusPayload(),
				});
				socket.end();
			}
		});
		active.set(request.id, { abort, done });
	};
	socket.on("data", (chunk: Buffer) => {
		try {
			for (const raw of decoder.push(chunk)) {
				const request = parseClientMessage(raw);
				if (request.type === "run") startRun(request);
				else if (request.type === "cancel") active.get(request.id)?.abort?.();
				else if (request.type === "status") {
					send(socket, { type: "status", id: request.id, status: statusPayload() });
					completed = true;
					socket.end();
				} else if (request.type === "stop") {
					send(socket, { type: "result", id: request.id, exitCode: 0, status: statusPayload() });
					completed = true;
					socket.end();
					setImmediate(() => void shutdown());
				}
			}
		} catch (error) {
			fail(ownedRequestId ?? randomUUID(), error);
		}
	});
	socket.on("error", () => {});
	socket.on("close", () => {
		if (!completed && ownedRequestId) active.get(ownedRequestId)?.abort?.();
	});
}

const server = createServer(handleConnection);
async function shutdown(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const request of active.values()) request.abort?.();
	await Promise.allSettled([...active.values()].map((request) => request.done));
	await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
	try {
		await unlink(socketPath);
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.on(signal, () => {
		void shutdown().finally(() => {
			process.exitCode = signal === "SIGINT" ? 130 : 0;
		});
	});
}
if (await prepareSocket(socketPath)) {
	server.on("error", (error: Error) => {
		console.error(error);
		process.exitCode = 1;
	});
	server.listen(socketPath, async () => {
		await chmod(socketPath, 0o600);
		console.log(`pies daemon ${process.pid} listening on ${socketPath} (Pi SDK ${VERSION})`);
	});
}

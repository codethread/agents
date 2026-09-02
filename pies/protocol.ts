import { tmpdir } from "node:os";
import { join } from "node:path";

export const PROTOCOL_VERSION = 5;
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export interface RunRequest {
	protocol: number;
	type: "run";
	id: string;
	cwd: string;
	env: Record<string, string>;
	args: string[];
	stdin?: string;
}

export interface ControlRequest {
	protocol: number;
	type: "status" | "stop" | "cancel";
	id: string;
}

export type ClientMessage = RunRequest | ControlRequest;
export type ProtocolFrame = Record<string, unknown>;
export interface ProtocolSocket {
	write(data: string): boolean;
}

export function defaultSocketPath(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PIES_SOCKET) return env.PIES_SOCKET;
	const uid = typeof process.getuid === "function" ? process.getuid() : "user";
	return join(env.XDG_RUNTIME_DIR || tmpdir(), `pies-${uid}.sock`);
}

export function encodeFrame(message: unknown): string {
	return `${JSON.stringify(message)}\n`;
}

export function writeFrame(socket: ProtocolSocket, message: unknown): boolean {
	return socket.write(encodeFrame(message));
}

export function isProtocolMismatchFrame(message: unknown): boolean {
	if (!message || typeof message !== "object" || Array.isArray(message)) return false;
	const frame = message as ProtocolFrame;
	return (
		frame.type === "stderr" &&
		typeof frame.data === "string" &&
		frame.data.startsWith("Unsupported protocol version:")
	);
}

export class LineDecoder {
	#buffer = Buffer.alloc(0);

	push(chunk: Buffer | Uint8Array | string): unknown[] {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		this.#buffer = Buffer.concat([this.#buffer, bytes]);

		const messages: unknown[] = [];
		let newline = this.#buffer.indexOf(0x0a);
		while (newline !== -1) {
			if (newline > MAX_FRAME_BYTES) {
				throw new Error(`Protocol frame exceeds ${MAX_FRAME_BYTES} bytes`);
			}
			const line = this.#buffer.subarray(0, newline).toString("utf8");
			this.#buffer = this.#buffer.slice(newline + 1);
			if (line.trim()) messages.push(JSON.parse(line));
			newline = this.#buffer.indexOf(0x0a);
		}
		if (this.#buffer.length > MAX_FRAME_BYTES) {
			throw new Error(`Protocol frame exceeds ${MAX_FRAME_BYTES} bytes`);
		}
		return messages;
	}

	finish(): void {
		if (this.#buffer.toString("utf8").trim()) throw new Error("Incomplete protocol frame");
	}
}

export function parseClientMessage(value: unknown): ClientMessage {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Protocol message must be an object");
	}
	const message = value as ProtocolFrame;
	if (message.protocol !== PROTOCOL_VERSION) {
		throw new Error(`Unsupported protocol version: ${String(message.protocol)}`);
	}
	if (typeof message.id !== "string" || message.id.length === 0) {
		throw new Error("Protocol message requires a non-empty id");
	}

	if (message.type === "run") {
		if (
			typeof message.cwd !== "string" ||
			!message.env ||
			typeof message.env !== "object" ||
			Array.isArray(message.env) ||
			!Array.isArray(message.args)
		) {
			throw new Error("Run request requires cwd, env, and args");
		}
		if (!Object.values(message.env).every((entry) => typeof entry === "string")) {
			throw new Error("Run request env values must be strings");
		}
		if (!message.args.every((arg) => typeof arg === "string")) {
			throw new Error("Run request args must be strings");
		}
		if (message.stdin !== undefined && typeof message.stdin !== "string") {
			throw new Error("Run request stdin must be a string");
		}
		return message as unknown as RunRequest;
	}

	if (["status", "stop", "cancel"].includes(message.type as string)) {
		return message as unknown as ControlRequest;
	}
	throw new Error(`Unknown protocol message type: ${String(message.type)}`);
}

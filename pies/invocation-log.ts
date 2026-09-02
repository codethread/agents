import { mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const REDACTED = "[REDACTED]";
const NUMBER_VALUE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const appendQueues = new Map<string, Promise<void>>();

export type InvocationEnvironment = NodeJS.ProcessEnv;
export type InvocationRecord = Record<string, unknown>;

export function invocationLogPath(
	env: InvocationEnvironment = process.env,
	cwd = process.cwd(),
): string {
	if (env.PIES_LOG_FILE) {
		return isAbsolute(env.PIES_LOG_FILE) ? env.PIES_LOG_FILE : resolve(cwd, env.PIES_LOG_FILE);
	}
	const stateHome = env.XDG_STATE_HOME
		? isAbsolute(env.XDG_STATE_HOME)
			? env.XDG_STATE_HOME
			: resolve(cwd, env.XDG_STATE_HOME)
		: join(env.HOME || homedir(), ".local", "state");
	return join(stateHome, "pies", "invocations.jsonl");
}

export function redactEnvironment(env: InvocationEnvironment): InvocationEnvironment {
	return Object.fromEntries(
		Object.entries(env).map(([key, value]) => [
			key,
			value !== undefined && (/^(?:true|false)$/i.test(value) || NUMBER_VALUE.test(value))
				? value
				: REDACTED,
		]),
	);
}

export function redactArgs(args: string[]): string[] {
	const redacted: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--api-key") {
			redacted.push(arg);
			if (index + 1 < args.length) {
				redacted.push(REDACTED);
				index += 1;
			}
		} else if (arg.startsWith("--api-key=")) redacted.push(`--api-key=${REDACTED}`);
		else redacted.push(arg);
	}
	return redacted;
}

async function append(path: string, record: InvocationRecord): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const file = await open(path, "a", 0o600);
	try {
		await file.chmod(0o600);
		await file.appendFile(`${JSON.stringify(record)}\n`, "utf8");
	} finally {
		await file.close();
	}
}

export async function appendInvocationRecord(
	path: string,
	record: InvocationRecord,
): Promise<void> {
	const previous = appendQueues.get(path) ?? Promise.resolve();
	const queued = previous.catch(() => {}).then(() => append(path, record));
	appendQueues.set(path, queued);
	try {
		await queued;
	} finally {
		if (appendQueues.get(path) === queued) appendQueues.delete(path);
	}
}

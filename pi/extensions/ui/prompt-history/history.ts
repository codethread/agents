import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const PROMPT_HISTORY_VERSION = 1;
export const PROMPT_HISTORY_LIMIT = 100;
const CHUNK_SIZE_BYTES = 16 * 1024;

export interface PromptHistoryRecord {
	version: typeof PROMPT_HISTORY_VERSION;
	timestamp: number;
	message: string;
	cwd: string;
	repoRoot: string;
}

export type PromptHistoryScope =
	| { type: "cwd"; cwd: string }
	| { type: "repo"; repoRoot: string }
	| { type: "global" };

export function getPromptHistoryCachePath(env: NodeJS.ProcessEnv = process.env): string {
	const xdgCacheHome = env.XDG_CACHE_HOME?.trim();
	const cacheRoot = xdgCacheHome || path.join(os.homedir(), ".cache");
	return path.join(cacheRoot, "pi", "messages.jsonl");
}

export function createPromptHistoryRecord(input: {
	message: string;
	cwd: string;
	repoRoot: string;
	timestamp?: number;
}): PromptHistoryRecord {
	return {
		version: PROMPT_HISTORY_VERSION,
		timestamp: input.timestamp ?? Date.now(),
		message: input.message,
		cwd: input.cwd,
		repoRoot: input.repoRoot,
	};
}

export function encodePromptHistoryRecord(record: PromptHistoryRecord): string {
	return JSON.stringify(record);
}

export function parsePromptHistoryRecordLine(line: string): PromptHistoryRecord | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;

	const value = JSON.parse(trimmed) as Partial<PromptHistoryRecord>;
	if (value.version !== PROMPT_HISTORY_VERSION) {
		throw new Error(`Unsupported prompt history version: ${String(value.version)}`);
	}
	if (!Number.isFinite(value.timestamp)) {
		throw new Error("Prompt history record is missing a valid timestamp.");
	}
	if (typeof value.message !== "string") {
		throw new Error("Prompt history record is missing a string message.");
	}
	if (typeof value.cwd !== "string") {
		throw new Error("Prompt history record is missing a string cwd.");
	}
	if (typeof value.repoRoot !== "string") {
		throw new Error("Prompt history record is missing a string repoRoot.");
	}

	return value as PromptHistoryRecord;
}

export async function appendPromptHistoryRecord(
	record: PromptHistoryRecord,
	options: { cachePath?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
	const cachePath = options.cachePath ?? getPromptHistoryCachePath(options.env);
	await fs.mkdir(path.dirname(cachePath), { recursive: true });
	await fs.appendFile(cachePath, `${encodePromptHistoryRecord(record)}\n`, "utf8");
	return cachePath;
}

function matchesScope(record: PromptHistoryRecord, scope: PromptHistoryScope): boolean {
	switch (scope.type) {
		case "cwd":
			return record.cwd === scope.cwd;
		case "repo":
			return record.repoRoot === scope.repoRoot;
		case "global":
			return true;
	}
}

export async function loadPromptHistoryRecords(
	scope: PromptHistoryScope,
	options: { cachePath?: string; env?: NodeJS.ProcessEnv; limit?: number } = {},
): Promise<PromptHistoryRecord[]> {
	const cachePath = options.cachePath ?? getPromptHistoryCachePath(options.env);
	const limit = Math.max(1, options.limit ?? PROMPT_HISTORY_LIMIT);

	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(cachePath, "r");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return [];
		throw error;
	}

	const matches: PromptHistoryRecord[] = [];

	const processLine = (line: string) => {
		if (matches.length >= limit) return;
		const parsed = parsePromptHistoryRecordLine(line.replace(/\r$/, ""));
		if (!parsed) return;
		if (matchesScope(parsed, scope)) matches.push(parsed);
	};

	try {
		const stat = await handle.stat();
		let position = stat.size;
		let tail = Buffer.alloc(0);

		while (position > 0 && matches.length < limit) {
			const bytesToRead = Math.min(CHUNK_SIZE_BYTES, position);
			position -= bytesToRead;

			const chunk = Buffer.alloc(bytesToRead);
			await handle.read(chunk, 0, bytesToRead, position);
			const combined = tail.length > 0 ? Buffer.concat([chunk, tail]) : chunk;

			let lineEnd = combined.length;
			for (let index = combined.length - 1; index >= 0; index -= 1) {
				if (combined[index] !== 0x0a) continue;
				const lineBuffer = combined.subarray(index + 1, lineEnd);
				processLine(lineBuffer.toString("utf8"));
				lineEnd = index;
				if (matches.length >= limit) break;
			}

			tail = combined.subarray(0, lineEnd);
		}

		if (matches.length < limit && tail.length > 0) {
			processLine(tail.toString("utf8"));
		}
	} finally {
		await handle.close();
	}

	return matches;
}

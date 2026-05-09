import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";

export interface ManifestEntry {
	id: string;
	agent: string;
	agentSource: string;
	provider?: string;
	model?: string;
	thinking: string | null;
	description: string;
	prompt: string;
	sessionFile: string;
	timestamp: string;
	exitCode: number;
	usage: { input: number; output: number; cost: number };
	durationMs: number;
}

export interface Manifest {
	parent: {
		sessionFile: string;
		sessionId: string;
	};
	cwd: string;
	subagents: ManifestEntry[];
}

function getSubagentSessionDir(parentSessionId: string, cwd: string): string {
	const encodedCwd = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const agentDir = path.join(os.homedir(), ".pi", "agent");
	return path.join(agentDir, "subagent-sessions", encodedCwd, parentSessionId);
}

export function getSubagentSessionPath(
	_parentSessionFile: string,
	parentSessionId: string,
	cwd: string,
): { dir: string; sessionFile: string; sessionId: string } {
	const sessionId = randomUUID();
	return getSubagentSessionPathForId(parentSessionId, cwd, sessionId);
}

function getSubagentSessionPathForId(
	parentSessionId: string,
	cwd: string,
	sessionId: string,
): { dir: string; sessionFile: string; sessionId: string } {
	const dir = getSubagentSessionDir(parentSessionId, cwd);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	return {
		dir,
		sessionFile: path.join(dir, `${sessionId}.jsonl`),
		sessionId,
	};
}

export function getSubagentSessionDirForParent(parentSessionId: string, cwd: string): string {
	const dir = getSubagentSessionDir(parentSessionId, cwd);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	return dir;
}

export async function findSubagentSessionFileById(
	dir: string,
	sessionId: string,
): Promise<string | undefined> {
	let files: string[];
	try {
		files = await fs.promises.readdir(dir);
	} catch {
		return undefined;
	}

	for (const file of files) {
		if (!file.endsWith(".jsonl")) continue;
		try {
			const sessionFile = path.join(dir, file);
			const firstLine = (await fs.promises.readFile(sessionFile, "utf8")).split("\n", 1)[0];
			const header = JSON.parse(firstLine) as { type?: string; id?: string };
			if (header.type === "session" && header.id?.startsWith(sessionId)) return sessionFile;
		} catch {
			// Ignore malformed session files, matching Pi's session listing behavior.
		}
	}
	return undefined;
}

export async function updateManifest(
	dir: string,
	parentInfo: { sessionFile: string; sessionId: string },
	cwd: string,
	entry: ManifestEntry,
): Promise<void> {
	const manifestPath = path.join(dir, "manifest.json");
	let manifest: Manifest = {
		parent: {
			sessionFile: parentInfo.sessionFile,
			sessionId: parentInfo.sessionId,
		},
		cwd,
		subagents: [],
	};

	try {
		const raw = await fs.promises.readFile(manifestPath, "utf8");
		const parsed = JSON.parse(raw) as Partial<Manifest>;
		manifest = {
			parent: parsed.parent ?? manifest.parent,
			cwd: parsed.cwd ?? manifest.cwd,
			subagents: Array.isArray(parsed.subagents) ? parsed.subagents : [],
		};
	} catch {
		// create new manifest on first run or malformed content
	}

	manifest.parent = {
		sessionFile: parentInfo.sessionFile,
		sessionId: parentInfo.sessionId,
	};
	manifest.cwd = cwd;
	const existingIndex = manifest.subagents.findIndex((subagent) => subagent.id === entry.id);
	if (existingIndex >= 0) manifest.subagents[existingIndex] = entry;
	else manifest.subagents.push(entry);

	await withFileMutationQueue(manifestPath, async () => {
		await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	});
}

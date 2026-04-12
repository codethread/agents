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

export function getSubagentSessionPath(
	parentSessionFile: string,
	parentSessionId: string,
	cwd: string,
): { dir: string; sessionFile: string; sessionId: string } {
	const encodedCwd = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const agentDir = path.join(os.homedir(), ".pi", "agent");
	const dir = path.join(agentDir, "subagent-sessions", encodedCwd, parentSessionId);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const sessionId = randomUUID();
	return {
		dir,
		sessionFile: path.join(dir, `${sessionId}.jsonl`),
		sessionId,
	};
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

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";

import type { AttemptMetadata } from "./types.js";

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
	attempts?: AttemptMetadata[];
}

export interface SwarmManifestMember {
	name: string;
	sessionId?: string;
	sessionFile?: string;
	lastExitCode: number;
}

export interface SwarmManifestEntry {
	id: string;
	target: string;
	description: string;
	prompt: string;
	timestamp: string;
	members: SwarmManifestMember[];
}

export interface SwarmManifest {
	parent: {
		sessionFile: string;
		sessionId: string;
	};
	cwd: string;
	swarms: SwarmManifestEntry[];
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
			if (header.type === "session" && header.id === sessionId) return sessionFile;
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

	await withFileMutationQueue(manifestPath, async () => {
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
		if (existingIndex >= 0) manifest.subagents.splice(existingIndex, 1);
		manifest.subagents.push(entry);

		await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	});
}

export async function getLatestSubagentSessionIdForAgent(
	dir: string,
	agentName: string,
): Promise<string | undefined> {
	const manifestPath = path.join(dir, "manifest.json");
	let manifest: unknown;
	try {
		manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
	} catch {
		return undefined;
	}

	const subagents =
		manifest && typeof manifest === "object" && "subagents" in manifest
			? manifest.subagents
			: undefined;
	if (!Array.isArray(subagents)) return undefined;

	const matching = [...subagents].reverse().find((entry) => {
		return (
			entry &&
			typeof entry === "object" &&
			"agent" in entry &&
			entry.agent === agentName &&
			"id" in entry &&
			typeof entry.id === "string" &&
			entry.id.trim()
		);
	});

	if (!matching || !matching.id || typeof matching.id !== "string") return undefined;
	return matching.id;
}

export async function getSubagentManifestEntryById(
	dir: string,
	id: string,
): Promise<ManifestEntry | undefined> {
	const manifestPath = path.join(dir, "manifest.json");
	let manifest: unknown;
	try {
		manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
	} catch {
		return undefined;
	}

	const subagents =
		manifest && typeof manifest === "object" && "subagents" in manifest
			? manifest.subagents
			: undefined;
	if (!Array.isArray(subagents)) return undefined;

	const matching = subagents.find((entry) => {
		return (
			entry &&
			typeof entry === "object" &&
			"id" in entry &&
			typeof entry.id === "string" &&
			entry.id === id
		);
	});
	if (!matching) return undefined;
	if (
		typeof matching.id !== "string" ||
		typeof matching.agent !== "string" ||
		typeof matching.description !== "string" ||
		typeof matching.prompt !== "string" ||
		typeof matching.timestamp !== "string"
	) {
		return undefined;
	}
	return matching as ManifestEntry;
}

export async function updateSwarmManifest(
	dir: string,
	parentInfo: { sessionFile: string; sessionId: string },
	cwd: string,
	entry: SwarmManifestEntry,
): Promise<void> {
	const manifestPath = path.join(dir, "swarm-manifest.json");

	await withFileMutationQueue(manifestPath, async () => {
		let manifest: SwarmManifest = {
			parent: {
				sessionFile: parentInfo.sessionFile,
				sessionId: parentInfo.sessionId,
			},
			cwd,
			swarms: [],
		};

		try {
			const raw = await fs.promises.readFile(manifestPath, "utf8");
			const parsed = JSON.parse(raw) as Partial<SwarmManifest>;
			manifest = {
				parent: parsed.parent ?? manifest.parent,
				cwd: parsed.cwd ?? manifest.cwd,
				swarms: Array.isArray(parsed.swarms) ? parsed.swarms : [],
			};
		} catch {
			// create new manifest on first run or malformed content
		}

		manifest.parent = {
			sessionFile: parentInfo.sessionFile,
			sessionId: parentInfo.sessionId,
		};
		manifest.cwd = cwd;
		const existingIndex = manifest.swarms.findIndex((swarm) => swarm.id === entry.id);
		if (existingIndex >= 0) manifest.swarms.splice(existingIndex, 1);
		manifest.swarms.push({
			...entry,
			members: entry.members.map((member) => ({
				...member,
				sessionFile: member.sessionFile ? path.basename(member.sessionFile) : undefined,
			})),
		});

		await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	});
}

export async function getLatestSwarmResumeIdForTarget(
	dir: string,
	target: string,
): Promise<string | undefined> {
	const manifestPath = path.join(dir, "swarm-manifest.json");
	let manifest: unknown;
	try {
		manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
	} catch {
		return undefined;
	}

	const swarms =
		manifest && typeof manifest === "object" && "swarms" in manifest ? manifest.swarms : undefined;
	if (!Array.isArray(swarms)) return undefined;

	const matching = [...swarms].reverse().find((entry) => {
		return (
			entry &&
			typeof entry === "object" &&
			"target" in entry &&
			entry.target === target &&
			"id" in entry &&
			typeof entry.id === "string" &&
			entry.id.trim()
		);
	});

	if (!matching || !matching.id || typeof matching.id !== "string") return undefined;
	return matching.id;
}

export async function getSwarmManifestEntryById(
	dir: string,
	id: string,
): Promise<SwarmManifestEntry | undefined> {
	const manifestPath = path.join(dir, "swarm-manifest.json");
	let manifest: unknown;
	try {
		manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
	} catch {
		return undefined;
	}

	const swarms =
		manifest && typeof manifest === "object" && "swarms" in manifest ? manifest.swarms : undefined;
	if (!Array.isArray(swarms)) return undefined;

	const matching = swarms.find((entry) => {
		return (
			entry &&
			typeof entry === "object" &&
			"id" in entry &&
			typeof entry.id === "string" &&
			entry.id === id
		);
	});
	if (!matching) return undefined;
	if (
		typeof matching.id !== "string" ||
		typeof matching.target !== "string" ||
		typeof matching.description !== "string" ||
		typeof matching.prompt !== "string" ||
		!Array.isArray(matching.members) ||
		typeof matching.timestamp !== "string"
	) {
		return undefined;
	}
	return matching as SwarmManifestEntry;
}

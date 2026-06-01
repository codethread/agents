import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	findSubagentSessionFileById,
	getSubagentSessionPath,
	getLatestSubagentSessionIdForAgent,
	getSubagentManifestEntryById,
	getLatestSwarmResumeIdForTarget,
	getSwarmManifestEntryById,
	updateManifest,
	updateSwarmManifest,
	type ManifestEntry,
	type SwarmManifestEntry,
} from "./session.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalUserProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = originalUserProfile;
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function readManifest(manifestPath: string): unknown {
	return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
	return {
		id: "test-uuid-1",
		agent: "scout",
		agentSource: "package",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		thinking: "high",
		description: "map auth flow",
		prompt: "Map the auth flow from route to DB...",
		sessionFile: "test-uuid-1.jsonl",
		timestamp: "2026-04-12T11:14:44.000Z",
		exitCode: 0,
		usage: { input: 5000, output: 1200, cost: 0.023 },
		durationMs: 12400,
		...overrides,
	};
}

function makeSwarmEntry(overrides: Partial<SwarmManifestEntry> = {}): SwarmManifestEntry {
	return {
		id: "swarm-review-001",
		target: "review",
		description: "review auth flow",
		prompt: "Review the auth flow",
		timestamp: "2026-04-12T11:14:44.000Z",
		members: [
			{
				name: "scout",
				lastExitCode: 0,
				sessionId: "uuid-scout-1",
				sessionFile: "uuid-scout-1.jsonl",
			},
			{ name: "hack", lastExitCode: 1, sessionId: "uuid-hack-1", sessionFile: "uuid-hack-1.jsonl" },
		],
		...overrides,
	};
}

describe("getSubagentSessionPath", () => {
	it("creates a session dir under encoded cwd and returns a UUID session file path", () => {
		const fakeHome = makeTempDir("subagent-home-");
		process.env.HOME = fakeHome;
		process.env.USERPROFILE = fakeHome;

		const parentSessionId = "parent-session-123";
		const cwd = "/home/user/project";
		const result = getSubagentSessionPath("/tmp/parent-session.jsonl", parentSessionId, cwd);

		const expectedDir = path.join(
			fakeHome,
			".pi",
			"agent",
			"subagent-sessions",
			"--home-user-project--",
			parentSessionId,
		);
		expect(result.dir).toBe(expectedDir);
		expect(fs.existsSync(result.dir)).toBe(true);
		expect(fs.statSync(result.dir).isDirectory()).toBe(true);

		expect(result.sessionId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
		expect(result.sessionFile).toBe(path.join(expectedDir, `${result.sessionId}.jsonl`));
	});
});

describe("findSubagentSessionFileById", () => {
	it("finds a session file by exact Pi session header ID", async () => {
		const dir = makeTempDir("subagent-find-session-");
		const sessionFile = path.join(dir, "storage-id.jsonl");
		fs.writeFileSync(
			sessionFile,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id: "pi-session-id-123",
				timestamp: "2026-05-09T00:00:00.000Z",
				cwd: "/repo/project",
			})}\n`,
			"utf8",
		);

		expect(await findSubagentSessionFileById(dir, "pi-session-id-123")).toBe(sessionFile);
	});

	it("does not match a partial session header ID", async () => {
		const dir = makeTempDir("subagent-find-session-partial-");
		const sessionFile = path.join(dir, "storage-id.jsonl");
		fs.writeFileSync(
			sessionFile,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id: "pi-session-id-123",
				timestamp: "2026-05-09T00:00:00.000Z",
				cwd: "/repo/project",
			})}\n`,
			"utf8",
		);

		expect(await findSubagentSessionFileById(dir, "pi-session-id")).toBeUndefined();
	});
});

describe("updateManifest", () => {
	it("creates manifest.json when missing and appends a subagent entry", async () => {
		const dir = makeTempDir("subagent-manifest-missing-");
		const entry = makeEntry();
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		await updateManifest(dir, parentInfo, cwd, entry);

		const manifestPath = path.join(dir, "manifest.json");
		expect(fs.existsSync(manifestPath)).toBe(true);
		expect(readManifest(manifestPath)).toEqual({
			parent: parentInfo,
			cwd,
			subagents: [entry],
		});
	});

	it("persists compact model-chain attempt metadata", async () => {
		const dir = makeTempDir("subagent-manifest-attempts-");
		const entry = makeEntry({
			attempts: [
				{
					attemptedModel: "provider/a",
					attempt: 1,
					success: false,
					exitCode: 1,
					error: "model unavailable",
					retryable: false,
				},
				{ attemptedModel: "provider/b", attempt: 1, success: true, exitCode: 0 },
			],
		});
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		await updateManifest(dir, parentInfo, cwd, entry);

		const manifest = readManifest(path.join(dir, "manifest.json")) as {
			subagents: ManifestEntry[];
		};
		expect(manifest.subagents[0]?.attempts).toEqual(entry.attempts);
	});

	it("moves updated ids to the end so explicit resume updates win recency", async () => {
		const dir = makeTempDir("subagent-manifest-upsert-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		const first = makeEntry({
			id: "test-uuid-1",
			description: "initial scout run",
			agent: "scout",
		});
		const second = makeEntry({
			id: "test-uuid-2",
			sessionFile: "test-uuid-2.jsonl",
			description: "later scout run",
			agent: "scout",
		});
		const resumedFirst = makeEntry({
			id: "test-uuid-1",
			exitCode: 1,
			durationMs: 9999,
			timestamp: "2026-04-12T12:00:00.000Z",
			description: "resumed scout run",
			sessionFile: "resumed-test-uuid-1.jsonl",
		});

		await updateManifest(dir, parentInfo, cwd, first);
		await updateManifest(dir, parentInfo, cwd, second);
		await updateManifest(dir, parentInfo, cwd, resumedFirst);

		const manifest = readManifest(path.join(dir, "manifest.json")) as {
			parent: { sessionFile: string; sessionId: string };
			cwd: string;
			subagents: ManifestEntry[];
		};
		expect(manifest.parent).toEqual(parentInfo);
		expect(manifest.cwd).toBe(cwd);
		expect(manifest.subagents).toHaveLength(2);
		expect(manifest.subagents).toEqual([second, resumedFirst]);
	});

	it("serializes concurrent updates without dropping manifest rows", async () => {
		const dir = makeTempDir("subagent-manifest-concurrent-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		const updates = Array.from({ length: 20 }, (_, index) => {
			return updateManifest(
				dir,
				parentInfo,
				cwd,
				makeEntry({
					id: `test-uuid-${index + 1}`,
					sessionFile: `test-uuid-${index + 1}.jsonl`,
					description: `run ${index + 1}`,
				}),
			);
		});

		await Promise.all(updates);

		const manifest = readManifest(path.join(dir, "manifest.json")) as {
			parent: { sessionFile: string; sessionId: string };
			cwd: string;
			subagents: ManifestEntry[];
		};

		expect(manifest.subagents).toHaveLength(updates.length);
		const ids = new Set(manifest.subagents.map((entry) => entry.id));
		expect(ids.size).toBe(updates.length);
		for (let index = 1; index <= 20; index++) {
			expect(ids.has(`test-uuid-${index}`)).toBe(true);
		}
	});

	it("recovers gracefully from malformed manifest content", async () => {
		const dir = makeTempDir("subagent-manifest-malformed-");
		const manifestPath = path.join(dir, "manifest.json");
		fs.writeFileSync(manifestPath, "{ this is not valid json", "utf8");

		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";
		const entry = makeEntry();

		await updateManifest(dir, parentInfo, cwd, entry);

		expect(readManifest(manifestPath)).toEqual({
			parent: parentInfo,
			cwd,
			subagents: [entry],
		});
	});
});

describe("getSubagentManifestEntryById", () => {
	it("returns matching subagent manifest entry by id", async () => {
		const dir = makeTempDir("subagent-manifest-entry-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";
		const entry = makeEntry({
			id: "subagent-single-001",
			agent: "scout",
		});

		await updateManifest(dir, parentInfo, cwd, entry);

		const found = await getSubagentManifestEntryById(dir, "subagent-single-001");
		expect(found).toEqual(entry);
	});

	it("returns undefined when no manifest entry exists for the id", async () => {
		const dir = makeTempDir("subagent-manifest-entry-miss-");
		const found = await getSubagentManifestEntryById(dir, "subagent-missing");
		expect(found).toBeUndefined();
	});

	it("returns undefined for malformed manifest entries", async () => {
		const dir = makeTempDir("subagent-manifest-entry-malformed-");
		const manifestPath = path.join(dir, "manifest.json");
		fs.writeFileSync(
			manifestPath,
			JSON.stringify({
				parent: {
					sessionFile: "/tmp/parent.jsonl",
					sessionId: "parent-session-id",
				},
				subagents: [{ id: "subagent-single-001", agent: "scout" }],
			}),
			"utf8",
		);

		const found = await getSubagentManifestEntryById(dir, "subagent-single-001");
		expect(found).toBeUndefined();
	});
});

describe("getLatestSubagentSessionIdForAgent", () => {
	it("returns the latest matching prior session for an agent", async () => {
		const dir = makeTempDir("subagent-manifest-lookup-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		await updateManifest(dir, parentInfo, cwd, makeEntry({ id: "test-uuid-1", agent: "scout" }));
		await updateManifest(dir, parentInfo, cwd, makeEntry({ id: "test-uuid-2", agent: "reviewer" }));
		await updateManifest(dir, parentInfo, cwd, makeEntry({ id: "test-uuid-3", agent: "scout" }));

		const latestSessionId = await getLatestSubagentSessionIdForAgent(dir, "scout");
		expect(latestSessionId).toBe("test-uuid-3");
	});

	it("returns an updated existing entry as latest when it is upserted later", async () => {
		const dir = makeTempDir("subagent-manifest-lookup-upsert-latest-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		await updateManifest(dir, parentInfo, cwd, makeEntry({ id: "test-uuid-1", agent: "scout" }));
		await updateManifest(dir, parentInfo, cwd, makeEntry({ id: "test-uuid-2", agent: "scout" }));
		await updateManifest(
			dir,
			parentInfo,
			cwd,
			makeEntry({ id: "test-uuid-1", agent: "scout", exitCode: 1, description: "resumed" }),
		);

		const latestSessionId = await getLatestSubagentSessionIdForAgent(dir, "scout");
		expect(latestSessionId).toBe("test-uuid-1");
	});

	it("returns undefined when no manifest entry matches the requested agent", async () => {
		const dir = makeTempDir("subagent-manifest-lookup-miss-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		await updateManifest(dir, parentInfo, cwd, makeEntry({ id: "test-uuid-1", agent: "reviewer" }));

		const latestSessionId = await getLatestSubagentSessionIdForAgent(dir, "scout");
		expect(latestSessionId).toBeUndefined();
	});

	it("returns undefined when the manifest is missing", async () => {
		const dir = makeTempDir("subagent-manifest-missing-lookup-");
		const latestSessionId = await getLatestSubagentSessionIdForAgent(dir, "scout");
		expect(latestSessionId).toBeUndefined();
	});
});

describe("updateSwarmManifest", () => {
	it("creates swarm-manifest.json when missing and appends a swarm entry", async () => {
		const dir = makeTempDir("swarm-manifest-missing-");
		const entry = makeSwarmEntry();
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		await updateSwarmManifest(dir, parentInfo, cwd, entry);

		const manifestPath = path.join(dir, "swarm-manifest.json");
		expect(fs.existsSync(manifestPath)).toBe(true);
		expect(readManifest(manifestPath)).toEqual({
			parent: parentInfo,
			cwd,
			swarms: [entry],
		});
	});

	it("normalizes swarm member session files to basenames", async () => {
		const dir = makeTempDir("swarm-manifest-session-file-basename-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";
		await updateSwarmManifest(
			dir,
			parentInfo,
			cwd,
			makeSwarmEntry({
				id: "swarm-review-abs",
				members: [
					{
						name: "scout",
						lastExitCode: 0,
						sessionId: "uuid-scout",
						sessionFile: "/abs/path/uuid-scout.jsonl",
					},
					{ name: "hack", lastExitCode: 1, sessionId: "uuid-hack", sessionFile: "uuid-hack.jsonl" },
				],
			}),
		);

		const manifest = readManifest(path.join(dir, "swarm-manifest.json")) as {
			parent: { sessionFile: string; sessionId: string };
			swarms: SwarmManifestEntry[];
			cwd: string;
		};
		expect(manifest.swarms[0].members).toEqual([
			{ name: "scout", lastExitCode: 0, sessionId: "uuid-scout", sessionFile: "uuid-scout.jsonl" },
			{ name: "hack", lastExitCode: 1, sessionId: "uuid-hack", sessionFile: "uuid-hack.jsonl" },
		]);
	});

	it("moves updated swarm ids to the end so later writes win recency", async () => {
		const dir = makeTempDir("swarm-manifest-upsert-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		const first = makeSwarmEntry({
			id: "swarm-review-001",
			target: "review",
			description: "initial review run",
		});
		const second = makeSwarmEntry({
			id: "swarm-review-002",
			target: "review",
			description: "second review run",
		});
		const updatedFirst = makeSwarmEntry({
			id: "swarm-review-001",
			description: "updated review run",
			timestamp: "2026-04-12T12:00:00.000Z",
			members: [
				{
					name: "scout",
					lastExitCode: 0,
					sessionId: "uuid-scout-2",
					sessionFile: "uuid-scout-2.jsonl",
				},
				{
					name: "hack",
					lastExitCode: 0,
					sessionId: "uuid-hack-2",
					sessionFile: "uuid-hack-2.jsonl",
				},
			],
		});

		await updateSwarmManifest(dir, parentInfo, cwd, first);
		await updateSwarmManifest(dir, parentInfo, cwd, second);
		await updateSwarmManifest(dir, parentInfo, cwd, updatedFirst);

		const manifest = readManifest(path.join(dir, "swarm-manifest.json")) as {
			parent: { sessionFile: string; sessionId: string };
			cwd: string;
			swarms: SwarmManifestEntry[];
		};
		expect(manifest.swarms).toHaveLength(2);
		expect(manifest.swarms).toEqual([second, updatedFirst]);
	});
});

describe("getLatestSwarmResumeIdForTarget", () => {
	it("returns the latest matching prior swarm resume id for a target", async () => {
		const dir = makeTempDir("swarm-manifest-lookup-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		await updateSwarmManifest(
			dir,
			parentInfo,
			cwd,
			makeSwarmEntry({
				id: "swarm-review-001",
				target: "review",
				timestamp: "2026-04-12T11:00:00.000Z",
			}),
		);
		await updateSwarmManifest(
			dir,
			parentInfo,
			cwd,
			makeSwarmEntry({
				id: "swarm-other-001",
				target: "security",
				timestamp: "2026-04-12T12:00:00.000Z",
			}),
		);
		await updateSwarmManifest(
			dir,
			parentInfo,
			cwd,
			makeSwarmEntry({
				id: "swarm-review-002",
				target: "review",
				timestamp: "2026-04-12T13:00:00.000Z",
			}),
		);

		const latestResumeId = await getLatestSwarmResumeIdForTarget(dir, "review");
		expect(latestResumeId).toBe("swarm-review-002");
	});

	it("returns updated existing swarm id when it is upserted later", async () => {
		const dir = makeTempDir("swarm-manifest-lookup-updated-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		await updateSwarmManifest(
			dir,
			parentInfo,
			cwd,
			makeSwarmEntry({ id: "swarm-review-001", target: "review" }),
		);
		await updateSwarmManifest(
			dir,
			parentInfo,
			cwd,
			makeSwarmEntry({ id: "swarm-review-002", target: "review" }),
		);
		await updateSwarmManifest(
			dir,
			parentInfo,
			cwd,
			makeSwarmEntry({
				id: "swarm-review-001",
				target: "review",
				description: "updated",
				timestamp: "2026-04-12T15:00:00.000Z",
			}),
		);

		const latestResumeId = await getLatestSwarmResumeIdForTarget(dir, "review");
		expect(latestResumeId).toBe("swarm-review-001");
	});

	it("returns undefined when no matching swarm exists", async () => {
		const dir = makeTempDir("swarm-manifest-lookup-miss-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		await updateSwarmManifest(
			dir,
			parentInfo,
			cwd,
			makeSwarmEntry({ id: "swarm-review-001", target: "review" }),
		);

		const latestResumeId = await getLatestSwarmResumeIdForTarget(dir, "security");
		expect(latestResumeId).toBeUndefined();
	});

	it("returns undefined when the manifest is missing", async () => {
		const dir = makeTempDir("swarm-manifest-lookup-missing-");
		const latestResumeId = await getLatestSwarmResumeIdForTarget(dir, "review");
		expect(latestResumeId).toBeUndefined();
	});
});

describe("getSwarmManifestEntryById", () => {
	it("returns matching swarm manifest entry by id", async () => {
		const dir = makeTempDir("swarm-manifest-entry-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";
		const entry = makeSwarmEntry({
			id: "swarm-review-001",
			target: "review",
			members: [
				{
					name: "scout",
					lastExitCode: 0,
					sessionId: "uuid-scout-1",
					sessionFile: "uuid-scout-1.jsonl",
				},
			],
		});

		await updateSwarmManifest(dir, parentInfo, cwd, entry);

		const found = await getSwarmManifestEntryById(dir, "swarm-review-001");
		expect(found).toEqual(entry);
	});

	it("returns undefined when no swarm entry exists for the id", async () => {
		const dir = makeTempDir("swarm-manifest-entry-miss-");
		const found = await getSwarmManifestEntryById(dir, "swarm-review-missing");
		expect(found).toBeUndefined();
	});
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	findSubagentSessionFileById,
	getSubagentSessionPath,
	updateManifest,
	type ManifestEntry,
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
	it("finds a session file by Pi session header ID prefix", async () => {
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

		expect(await findSubagentSessionFileById(dir, "pi-session-id")).toBe(sessionFile);
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

	it("upserts by entry.id and appends new ids while preserving parent/cwd", async () => {
		const dir = makeTempDir("subagent-manifest-upsert-");
		const parentInfo = {
			sessionFile: "/tmp/parent.jsonl",
			sessionId: "parent-session-id",
		};
		const cwd = "/repo/project";

		const first = makeEntry({ id: "test-uuid-1" });
		const updatedFirst = makeEntry({
			id: "test-uuid-1",
			exitCode: 1,
			durationMs: 9999,
			timestamp: "2026-04-12T12:00:00.000Z",
		});
		const second = makeEntry({
			id: "test-uuid-2",
			sessionFile: "test-uuid-2.jsonl",
			description: "inspect retry logic",
		});

		await updateManifest(dir, parentInfo, cwd, first);
		await updateManifest(dir, parentInfo, cwd, updatedFirst);
		await updateManifest(dir, parentInfo, cwd, second);

		const manifest = readManifest(path.join(dir, "manifest.json")) as {
			parent: { sessionFile: string; sessionId: string };
			cwd: string;
			subagents: ManifestEntry[];
		};
		expect(manifest.parent).toEqual(parentInfo);
		expect(manifest.cwd).toBe(cwd);
		expect(manifest.subagents).toHaveLength(2);
		expect(manifest.subagents.find((subagent) => subagent.id === "test-uuid-1")).toEqual(
			updatedFirst,
		);
		expect(manifest.subagents.find((subagent) => subagent.id === "test-uuid-2")).toEqual(second);
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

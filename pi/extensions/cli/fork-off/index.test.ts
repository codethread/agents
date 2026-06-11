import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createPrunedSessionFile, findLatestAssistantEntryId } from "./index.js";

function makeTempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("fork-off session pruning", () => {
	it("finds the latest assistant entry in the active branch", () => {
		expect(
			findLatestAssistantEntryId([
				{ type: "message", id: "user-1", message: { role: "user" } },
				{ type: "message", id: "assistant-1", message: { role: "assistant" } },
				{ type: "message", id: "user-2", message: { role: "user" } },
			]),
		).toBe("assistant-1");
	});

	it("writes a temp session containing only the selected entry ancestry", async () => {
		const dir = makeTempDir("fork-off-prune-");
		const sessionFile = path.join(dir, "session.jsonl");
		const entries = [
			{ type: "session", version: 3, id: "session-id", timestamp: "2026-01-01T00:00:00.000Z" },
			{ type: "message", id: "root", parentId: null, message: { role: "user", content: "root" } },
			{
				type: "message",
				id: "assistant",
				parentId: "root",
				message: { role: "assistant", content: [] },
			},
			{ type: "message", id: "active-user", parentId: "assistant", message: { role: "user" } },
			{ type: "message", id: "side", parentId: "root", message: { role: "user" } },
		];
		fs.writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

		const prunedFile = await createPrunedSessionFile(sessionFile, "assistant");
		const prunedEntries = fs
			.readFileSync(prunedFile, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		expect(prunedEntries.map((entry) => entry.id)).toEqual(["session-id", "root", "assistant"]);
	});
});

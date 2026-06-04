import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendPromptHistoryRecord,
	createPromptHistoryRecord,
	encodePromptHistoryRecord,
	loadPromptHistoryRecords,
	parsePromptHistoryRecordLine,
} from "./history.js";

const tempDirs: string[] = [];

async function makeTempCachePath(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-prompt-history-"));
	tempDirs.push(dir);
	return path.join(dir, "pi", "messages.jsonl");
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

describe("prompt-history storage", () => {
	it("round-trips markdown-heavy prompts through JSONL encoding", async () => {
		const cachePath = await makeTempCachePath();
		const message = [
			"# Request",
			"",
			"> quote",
			"",
			"```ts",
			"console.log('<tag />');",
			"```",
		].join("\n");

		await appendPromptHistoryRecord(
			createPromptHistoryRecord({
				message,
				cwd: "/repo/app",
				repoRoot: "/repo",
				timestamp: 1,
			}),
			{ cachePath },
		);

		const [record] = await loadPromptHistoryRecords({ type: "global" }, { cachePath });
		expect(record.message).toBe(message);
	});

	it("loads newest-first records for each recall scope", async () => {
		const cachePath = await makeTempCachePath();
		const lines = [
			createPromptHistoryRecord({
				message: "old cwd",
				cwd: "/repo/pkg-a",
				repoRoot: "/repo",
				timestamp: 1,
			}),
			createPromptHistoryRecord({
				message: "repo sibling",
				cwd: "/repo/pkg-b",
				repoRoot: "/repo",
				timestamp: 2,
			}),
			createPromptHistoryRecord({
				message: "other repo",
				cwd: "/other/app",
				repoRoot: "/other",
				timestamp: 3,
			}),
			createPromptHistoryRecord({
				message: "new cwd",
				cwd: "/repo/pkg-a",
				repoRoot: "/repo",
				timestamp: 4,
			}),
		].map(encodePromptHistoryRecord);
		await fs.mkdir(path.dirname(cachePath), { recursive: true });
		await fs.writeFile(cachePath, `${lines.join("\n")}\n`, "utf8");

		expect(
			(await loadPromptHistoryRecords({ type: "cwd", cwd: "/repo/pkg-a" }, { cachePath })).map(
				(record) => record.message,
			),
		).toEqual(["new cwd", "old cwd"]);
		expect(
			(await loadPromptHistoryRecords({ type: "repo", repoRoot: "/repo" }, { cachePath })).map(
				(record) => record.message,
			),
		).toEqual(["new cwd", "repo sibling", "old cwd"]);
		expect(
			(await loadPromptHistoryRecords({ type: "global" }, { cachePath })).map(
				(record) => record.message,
			),
		).toEqual(["new cwd", "other repo", "repo sibling", "old cwd"]);
	});

	it("caps recall buffers at one hundred matching records", async () => {
		const cachePath = await makeTempCachePath();
		await fs.mkdir(path.dirname(cachePath), { recursive: true });
		const lines = Array.from({ length: 105 }, (_, index) =>
			encodePromptHistoryRecord(
				createPromptHistoryRecord({
					message: `prompt-${index + 1}`,
					cwd: "/repo/app",
					repoRoot: "/repo",
					timestamp: index + 1,
				}),
			),
		);
		await fs.writeFile(cachePath, `${lines.join("\n")}\n`, "utf8");

		const records = await loadPromptHistoryRecords({ type: "global" }, { cachePath });
		expect(records).toHaveLength(100);
		expect(records[0].message).toBe("prompt-105");
		expect(records.at(-1)?.message).toBe("prompt-6");
	});

	it("rejects malformed records", () => {
		expect(() => parsePromptHistoryRecordLine('{"version":1,"message":true}')).toThrow(
			"Prompt history record is missing a valid timestamp.",
		);
	});
});

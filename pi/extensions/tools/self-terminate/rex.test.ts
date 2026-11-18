import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectRexWindow } from "./rex.js";

const dirs: string[] = [];
const target = { sessionId: "session:own", blockId: "block:own", windowId: "window:own" };
const ownBlock = { block_id: target.blockId, window_id: target.windowId };

function fixture(
	processes: unknown = { foreground: { pid: 123 } },
	blocks: unknown = { blocks: [ownBlock] },
) {
	const dir = mkdtempSync(join(tmpdir(), "self-terminate-test-"));
	dirs.push(dir);
	const calls = join(dir, "calls.jsonl");
	const blockFile = join(dir, "blocks.json");
	writeFileSync(blockFile, JSON.stringify(blocks));
	writeFileSync(
		join(dir, "rex"),
		`#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
if (args.includes('process')) console.log(process.env.TEST_PROCESSES);
else if (args.includes('ls')) console.log(readFileSync(process.env.TEST_BLOCKS, 'utf8'));
else if (process.env.TEST_FAIL_CLOSE) { console.error('close refused'); process.exit(1); }
else appendFileSync(process.env.TEST_CLOSED, 'closed');
`,
		{ mode: 0o700 },
	);
	const closed = join(dir, "closed");
	const env = {
		...process.env,
		PATH: `${dir}:${process.env.PATH}`,
		REX_SESSION: target.sessionId,
		REX_BLOCK: target.blockId,
		TEST_CALLS: calls,
		TEST_PROCESSES: JSON.stringify(processes),
		TEST_BLOCKS: blockFile,
		TEST_CLOSED: closed,
	};
	return { dir, env, calls, closed, blockFile };
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Rex detection adapter", () => {
	it("skips without inherited location, without running Rex", async () => {
		expect(await inspectRexWindow({}, 123)).toMatchObject({ kind: "skip" });
	});

	it("resolves the process's own tab and uses scoped argv", async () => {
		const f = fixture();
		expect(await inspectRexWindow(f.env, 123)).toEqual({ kind: "close", window: target });
		const calls = readFileSync(f.calls, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(calls).toEqual([
			[
				"--autostart=false",
				"--timeout",
				"3s",
				"block",
				"call",
				"-s",
				target.sessionId,
				"-b",
				target.blockId,
				"process",
			],
			["--autostart=false", "--timeout", "3s", "block", "ls", "-s", target.sessionId, "--json"],
		]);
	});

	it("accepts Pi in a foreground wrapper's ancestor list", async () => {
		const f = fixture({ foreground: { pid: 456 }, ancestors: [{ pid: 123 }] });
		expect(await inspectRexWindow(f.env, 123)).toMatchObject({ kind: "close" });
	});

	it("does not trust inherited IDs from a different process tree", async () => {
		const f = fixture({ foreground: { pid: 456 } });
		expect(await inspectRexWindow(f.env, 123)).toMatchObject({
			kind: "skip",
			reason: expect.stringContaining("process tree"),
		});
	});

	it("preserves a tab with unrelated panes", async () => {
		const f = fixture(undefined, { blocks: [ownBlock, { ...ownBlock, block_id: "block:other" }] });
		expect(await inspectRexWindow(f.env, 123)).toMatchObject({
			kind: "skip",
			reason: expect.stringContaining("other panes"),
		});
	});

	it.each([{ blocks: [] }, { blocks: [{ block_id: target.blockId }] }])(
		"skips missing or unplaced blocks: %j",
		async (blocks) => {
			const f = fixture(undefined, blocks);
			expect(await inspectRexWindow(f.env, 123)).toMatchObject({
				kind: "skip",
				reason: "Rex block has no window",
			});
		},
	);

	it("reports malformed CLI output rather than closing an unverified target", async () => {
		const f = fixture({ foreground: { pid: "invalid" } });
		expect(await inspectRexWindow(f.env, 123)).toMatchObject({
			kind: "skip",
			reason: expect.stringContaining("Rex detection failed"),
		});
	});

	it("reports an unavailable Rex executable", async () => {
		const f = fixture();
		expect(await inspectRexWindow({ ...f.env, PATH: f.dir + "/missing" }, 123)).toMatchObject({
			kind: "skip",
			reason: expect.stringContaining("ENOENT"),
		});
	});
});

describe.each(["node", "bun"])("detached Rex cleanup from %s", (runtime) => {
	it.each(["close", "shared", "gone", "failure"])(
		"waits for real parent exit and handles %s",
		async (scenario) => {
			const f = fixture();
			const logMarker = join(f.dir, "armed");
			const shutdownMarker = join(f.dir, "shutdown-hook");
			const adapter = new URL("./rex.ts", import.meta.url).href;
			const parent = spawn(
				runtime,
				[
					"--input-type=module",
					"-e",
					`
import { writeFileSync } from 'node:fs';
import { scheduleRexClose } from ${JSON.stringify(adapter)};
const log = await scheduleRexClose(${JSON.stringify(target)});
writeFileSync(${JSON.stringify(logMarker)}, log);
process.stdin.resume();
process.stdin.once('data', () => {
  writeFileSync(${JSON.stringify(shutdownMarker)}, 'cleanup finished');
  process.exit(0);
});
`,
				],
				{
					env: { ...f.env, TEST_FAIL_CLOSE: scenario === "failure" ? "1" : "" },
					stdio: ["pipe", "pipe", "pipe"],
				},
			);
			let stderr = "";
			parent.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			const exited = once(parent, "exit");
			try {
				await expect.poll(() => existsSync(logMarker) || stderr, { timeout: 10000 }).toBe(true);
				expect(existsSync(f.calls)).toBe(false);
				if (scenario === "shared")
					writeFileSync(
						f.blockFile,
						JSON.stringify({ blocks: [ownBlock, { ...ownBlock, block_id: "block:new" }] }),
					);
				if (scenario === "gone") writeFileSync(f.blockFile, JSON.stringify({ blocks: [] }));
				parent.stdin.write("exit\n");
				expect(await exited).toEqual([0, null]);
				expect(readFileSync(shutdownMarker, "utf8")).toBe("cleanup finished");
				const logPath = readFileSync(logMarker, "utf8");
				try {
					if (scenario === "close") {
						await expect.poll(() => existsSync(f.closed), { timeout: 10000 }).toBe(true);
						expect(readFileSync(f.calls, "utf8")).toContain(
							JSON.stringify([
								"--autostart=false",
								"--timeout",
								"3s",
								"window",
								"close",
								"-s",
								target.sessionId,
								target.windowId,
							]),
						);
					} else if (scenario === "shared" || scenario === "failure") {
						await expect
							.poll(() => readFileSync(logPath, "utf8"), { timeout: 10000 })
							.toContain(scenario === "shared" ? "refusing to close" : "close refused");
						expect(existsSync(f.closed)).toBe(false);
					} else {
						await expect.poll(() => existsSync(f.calls), { timeout: 10000 }).toBe(true);
						expect(existsSync(f.closed)).toBe(false);
					}
				} finally {
					rmSync(logPath, { force: true });
				}
			} finally {
				if (parent.exitCode === null) parent.kill();
			}
		},
		20000,
	);
});

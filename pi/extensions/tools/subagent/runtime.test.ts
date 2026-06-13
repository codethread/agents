import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSingleAgentArgs, runSingleAgent } from "./runtime.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
	spawn: spawnMock,
}));

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

afterEach(() => {
	spawnMock.mockReset();
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

function mockSpawnResult(result: { code: number; stderr?: string; stdoutLines?: unknown[] }) {
	spawnMock.mockImplementationOnce((_command: string, _args: string[]) => {
		const proc = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
			kill: ReturnType<typeof vi.fn>;
			killed: boolean;
		};
		proc.stdout = new PassThrough();
		proc.stderr = new PassThrough();
		proc.kill = vi.fn();
		proc.killed = false;
		queueMicrotask(() => {
			for (const line of result.stdoutLines ?? []) proc.stdout.write(`${JSON.stringify(line)}\n`);
			if (result.stderr) proc.stderr.write(result.stderr);
			proc.emit("close", result.code);
		});
		return proc;
	});
}

function testAgent(modelCandidates?: { id: string }[]) {
	return {
		name: "scout",
		description: "Scout",
		hidden: false,
		tools: [],
		model: modelCandidates?.[0]?.id,
		modelCandidates,
		systemPrompt: "Scout things",
		source: "package" as const,
		filePath: "/agents/scout.md",
	};
}

const request = {
	agent: "scout",
	description: "map things",
	task: "Map things",
	cwd: process.cwd(),
};

describe("runSingleAgent model chain", () => {
	it("succeeds transparently on the first candidate", async () => {
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
				},
			],
		});

		const result = await runSingleAgent(
			[testAgent([{ id: "openai/gpt-5.4-mini" }])],
			request,
			undefined,
			undefined,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.attempts).toEqual([
			{ attemptedModel: "openai/gpt-5.4-mini", attempt: 1, success: true, exitCode: 0 },
		]);
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	it("retries transient failures on the same candidate before succeeding", async () => {
		spawnMock.mockReset();
		mockSpawnResult({ code: 1, stderr: "provider rate limit 429" });
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
				},
			],
		});

		const result = await runSingleAgent(
			[testAgent([{ id: "openai/gpt-5.4-mini" }])],
			request,
			undefined,
			undefined,
		);

		expect(result.exitCode).toBe(0);
		expect(result.attempts).toEqual([
			{
				attemptedModel: "openai/gpt-5.4-mini",
				attempt: 1,
				success: false,
				exitCode: 1,
				error: "provider rate limit 429",
				retryable: true,
			},
			{ attemptedModel: "openai/gpt-5.4-mini", attempt: 2, success: true, exitCode: 0 },
		]);
		expect(spawnMock).toHaveBeenCalledTimes(2);
		expect(spawnMock.mock.calls[0]?.[1]).toContain("openai/gpt-5.4-mini");
		expect(spawnMock.mock.calls[1]?.[1]).toContain("openai/gpt-5.4-mini");
	});

	it("classifies stopReason error output as a model-chain failure", async () => {
		spawnMock.mockReset();
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "provider error" }],
						stopReason: "error",
						errorMessage: "provider service unavailable 503",
					},
				},
			],
		});
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
				},
			],
		});

		const result = await runSingleAgent(
			[testAgent([{ id: "provider/a" }])],
			request,
			undefined,
			undefined,
		);

		expect(result.exitCode).toBe(0);
		expect(result.attempts).toEqual([
			{
				attemptedModel: "provider/a",
				attempt: 1,
				success: false,
				exitCode: 0,
				error: "provider service unavailable 503",
				retryable: true,
			},
			{ attemptedModel: "provider/a", attempt: 2, success: true, exitCode: 0 },
		]);
		expect(spawnMock).toHaveBeenCalledTimes(2);
	});

	it("uses assistant error text when stopReason error has no structured errorMessage", async () => {
		spawnMock.mockReset();
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "provider service unavailable 503" }],
						stopReason: "error",
					},
				},
			],
		});
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
				},
			],
		});

		const result = await runSingleAgent(
			[testAgent([{ id: "provider/a" }])],
			request,
			undefined,
			undefined,
		);

		expect(result.exitCode).toBe(0);
		expect(result.attempts?.[0]).toMatchObject({
			attemptedModel: "provider/a",
			success: false,
			retryable: true,
			error: "provider service unavailable 503",
		});
		expect(spawnMock).toHaveBeenCalledTimes(2);
	});

	it("advances immediately on deterministic model availability failures", async () => {
		spawnMock.mockReset();
		mockSpawnResult({ code: 1, stderr: "model not found" });
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
				},
			],
		});

		const result = await runSingleAgent(
			[testAgent([{ id: "provider/missing" }, { id: "provider/ok" }])],
			request,
			undefined,
			undefined,
		);

		expect(result.exitCode).toBe(0);
		expect(spawnMock).toHaveBeenCalledTimes(2);
		expect(spawnMock.mock.calls[0]?.[1]).toContain("provider/missing");
		expect(spawnMock.mock.calls[1]?.[1]).toContain("provider/ok");
	});

	it("skips candidates known invalid by the active model registry", async () => {
		spawnMock.mockReset();
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
				},
			],
		});

		const result = await runSingleAgent(
			[testAgent([{ id: "provider/missing" }, { id: "provider/ok" }])],
			request,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				find: (provider, model) =>
					provider === "provider" && model === "ok" ? { provider, id: model } : undefined,
				hasConfiguredAuth: () => true,
			},
		);

		expect(result.exitCode).toBe(0);
		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(spawnMock.mock.calls[0]?.[1]).toContain("provider/ok");
		expect(result.attempts).toEqual([
			{ attemptedModel: "provider/ok", attempt: 1, success: true, exitCode: 0 },
		]);
	});

	it("persists model-chain attempts in the subagent manifest", async () => {
		const fakeHome = makeTempDir("subagent-runtime-home-");
		process.env.HOME = fakeHome;
		process.env.USERPROFILE = fakeHome;
		mockSpawnResult({ code: 1, stderr: "model not found" });
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{ type: "session", id: "child-session-id" },
				{
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
				},
			],
		});

		await runSingleAgent(
			[testAgent([{ id: "provider/a" }, { id: "provider/b" }])],
			request,
			undefined,
			undefined,
			undefined,
			{
				sessionFile: "/tmp/parent.jsonl",
				sessionId: "parent-session-id",
				cwd: request.cwd,
			},
		);

		const manifestPath = path.join(
			fakeHome,
			".pi",
			"agent",
			"subagent-sessions",
			`--${request.cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
			"parent-session-id",
			"manifest.json",
		);
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
			subagents: Array<{ attempts?: unknown[] }>;
		};
		expect(manifest.subagents[0]?.attempts).toEqual([
			{
				attemptedModel: "provider/a",
				attempt: 1,
				success: false,
				exitCode: 1,
				error: "model not found",
				retryable: false,
			},
			{ attemptedModel: "provider/b", attempt: 1, success: true, exitCode: 0 },
		]);
		expect(JSON.stringify(manifest.subagents[0]?.attempts)).not.toContain("ok");
		const sessionArgs = spawnMock.mock.calls.map((call) => call[1] as string[]);
		const sessionIds = sessionArgs.map((args) => args[args.indexOf("--session-id") + 1]);
		expect(sessionIds[0]).not.toBe(sessionIds[1]);
		expect(manifest.subagents[0]).toMatchObject({
			sessionFile: `${sessionIds[1]}.jsonl`,
		});
	});

	it("returns a clear failure after exhausting candidates", async () => {
		spawnMock.mockReset();
		mockSpawnResult({ code: 1, stderr: "provider service unavailable 503" });
		mockSpawnResult({ code: 1, stderr: "provider service unavailable 503" });
		mockSpawnResult({ code: 1, stderr: "provider service unavailable 503" });
		mockSpawnResult({ code: 1, stderr: "invalid api key" });

		const result = await runSingleAgent(
			[testAgent([{ id: "provider/a" }, { id: "provider/b" }])],
			request,
			undefined,
			undefined,
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("exhausting model candidates");
		expect(spawnMock).toHaveBeenCalledTimes(4);
	});

	it("stops immediately on context overflow", async () => {
		spawnMock.mockReset();
		mockSpawnResult({ code: 1, stderr: "exceeds the context window" });

		const result = await runSingleAgent(
			[testAgent([{ id: "provider/a" }, { id: "provider/b" }])],
			request,
			undefined,
			undefined,
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Reduce the delegated task scope");
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	it("uses Pi's classifier for successful silent context overflow", async () => {
		spawnMock.mockReset();
		mockSpawnResult({
			code: 0,
			stdoutLines: [
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "truncated" }],
						usage: {
							input: 120,
							output: 1,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 121,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "stop",
					},
				},
			],
		});

		const result = await runSingleAgent(
			[testAgent([{ id: "provider/a" }, { id: "provider/b" }])],
			request,
			undefined,
			undefined,
			(_provider, _model) => ({ contextWindow: 100 }),
		);

		expect(result.stderr).toContain("Reduce the delegated task scope");
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	it("does not treat normal non-provider failures as model-chain failures", async () => {
		spawnMock.mockReset();
		mockSpawnResult({
			code: 1,
			stderr:
				"vitest failed: expected HTTP 500 to be 200; got 429 in timeout/authentication quota test",
		});

		const result = await runSingleAgent(
			[testAgent([{ id: "provider/a" }, { id: "provider/b" }])],
			request,
			undefined,
			undefined,
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			"vitest failed: expected HTTP 500 to be 200; got 429 in timeout/authentication quota test",
		);
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});
});

describe("buildSingleAgentArgs", () => {
	it("uses --agent so child runs inherit the exact agent config", () => {
		expect(buildSingleAgentArgs("scout", "Map the subagent flow")).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"scout",
			"--no-session",
			"Task: Map the subagent flow",
		]);
	});

	it("forwards resolved --agents-dir roots to child runs", () => {
		expect(
			buildSingleAgentArgs("scout", "Map the subagent flow", undefined, undefined, [
				"/tmp/external-a",
				"/tmp/external-b",
			]),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"scout",
			"--agents-dir",
			"/tmp/external-a",
			"--agents-dir",
			"/tmp/external-b",
			"--no-session",
			"Task: Map the subagent flow",
		]);
	});

	it("passes an explicit candidate model without inherited thinking", () => {
		expect(
			buildSingleAgentArgs("fixer", "Fix the typecheck errors", {
				id: "openai/gpt-5.4-mini",
			}),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"fixer",
			"--model",
			"openai/gpt-5.4-mini",
			"--no-session",
			"Task: Fix the typecheck errors",
		]);
	});

	it("passes candidate-local thinking only when declared", () => {
		expect(
			buildSingleAgentArgs("fixer", "Fix the typecheck errors", {
				id: "openai/gpt-5.4-mini:low",
			}),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"fixer",
			"--model",
			"openai/gpt-5.4-mini",
			"--thinking",
			"low",
			"--no-session",
			"Task: Fix the typecheck errors",
		]);
	});

	it("keeps unrecognized suffixes in the model value", () => {
		expect(
			buildSingleAgentArgs("fixer", "Fix the typecheck errors", {
				id: "custom-provider/model:preview",
			}),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"fixer",
			"--model",
			"custom-provider/model:preview",
			"--no-session",
			"Task: Fix the typecheck errors",
		]);
	});

	it("still accepts an explicit session file when provided", () => {
		expect(
			buildSingleAgentArgs("fixer", "Fix the typecheck errors", undefined, {
				file: "/tmp/subagent.jsonl",
			}),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"fixer",
			"--session",
			"/tmp/subagent.jsonl",
			"Task: Fix the typecheck errors",
		]);
	});

	it("resumes child sessions by exact Pi session id", () => {
		expect(
			buildSingleAgentArgs(
				"review",
				"Review the fixes",
				{ id: "anthropic/claude-sonnet-4:medium" },
				{
					id: "session-id-123",
					dir: "/tmp/subagent-sessions",
				},
			),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--agent",
			"review",
			"--model",
			"anthropic/claude-sonnet-4",
			"--thinking",
			"medium",
			"--session-id",
			"session-id-123",
			"--session-dir",
			"/tmp/subagent-sessions",
			"Task: Review the fixes",
		]);
	});
});

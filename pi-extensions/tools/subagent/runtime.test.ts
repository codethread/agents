import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { buildSingleAgentArgs, runSingleAgent } from "./runtime.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
	spawn: spawnMock,
}));

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
		expect(spawnMock).toHaveBeenCalledTimes(2);
		expect(spawnMock.mock.calls[0]?.[1]).toContain("openai/gpt-5.4-mini");
		expect(spawnMock.mock.calls[1]?.[1]).toContain("openai/gpt-5.4-mini");
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

	it("persists child sessions when a session file is provided", () => {
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

	it("resumes child sessions through Pi's session lookup", () => {
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
			"--session",
			"session-id-123",
			"--session-dir",
			"/tmp/subagent-sessions",
			"Task: Review the fixes",
		]);
	});
});

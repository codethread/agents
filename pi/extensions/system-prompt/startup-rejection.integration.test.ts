import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import systemPromptExtension from "./index.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalRunId = process.env.MILLSTRAND_RUN_ID;
const tempDirs: string[] = [];

afterEach(async () => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	if (originalRunId === undefined) delete process.env.MILLSTRAND_RUN_ID;
	else process.env.MILLSTRAND_RUN_ID = originalRunId;
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("system-prompt startup rejection handling", () => {
	it("handles an invalid template rejection immediately while Strand startup is delayed", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-prompt-rejection-"));
		tempDirs.push(root);
		const cwd = join(root, "repo");
		const agentDir = join(root, "agent-home");
		await mkdir(cwd, { recursive: true });
		await mkdir(agentDir, { recursive: true });
		await writeFile(join(agentDir, "agent.njk"), "{% if invalid_template %}");
		process.env.PI_CODING_AGENT_DIR = agentDir;
		delete process.env.MILLSTRAND_RUN_ID;

		let finishStrand!: () => void;
		const exec = vi.fn(
			() =>
				new Promise((resolve) => {
					finishStrand = () =>
						resolve({
							stdout: JSON.stringify({
								operation: "identity startup",
								identity: "delayed-template-beaver",
								"strand-id": "identity-1",
								result: "minted",
								instruction: "Use delayed-template-beaver for identity-bearing operations.",
							}),
							stderr: "",
							code: 0,
							killed: false,
						});
				}),
		);
		const handlers = new Map<
			string,
			(event: unknown, ctx: unknown) => unknown | Promise<unknown>
		>();
		const emit = vi.fn();
		systemPromptExtension({
			events: { emit, on: vi.fn() },
			on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: vi.fn(() => false),
			getActiveTools: vi.fn(() => []),
			sendUserMessage: vi.fn(),
			exec,
		} as never);
		const unhandledRejection = vi.fn();
		process.on("unhandledRejection", unhandledRejection);
		const startup = handlers.get("session_start")!(
			{ type: "session_start", reason: "startup" },
			{
				cwd,
				hasUI: false,
				model: null,
				thinkingLevel: "low",
				sessionManager: { getSessionId: () => "session-1" },
			},
		) as Promise<unknown>;
		const rejection = expect(startup).rejects.toThrow(/parseIf: expected/);

		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(exec).toHaveBeenCalledTimes(1);
			expect(unhandledRejection).not.toHaveBeenCalled();
		} finally {
			finishStrand();
			process.off("unhandledRejection", unhandledRejection);
		}
		await rejection;
		expect(emit).toHaveBeenLastCalledWith(
			"codethread:millstrand-identity-context:v1",
			expect.objectContaining({
				identity: "delayed-template-beaver",
				nativeSessionId: "session-1",
			}),
		);
	});
});

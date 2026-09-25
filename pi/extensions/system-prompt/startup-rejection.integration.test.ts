import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTestSession, says, when, type TestSession } from "@gaodes/pi-test-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import systemPromptExtension from "./index.js";

const inheritedGitEnvironmentNames = Object.keys(process.env).filter((name) =>
	name.startsWith("GIT_"),
);
const tempDirs: string[] = [];
let runnerSession: TestSession | undefined;

async function project() {
	const root = await mkdtemp(join(tmpdir(), "pi-identity-startup-"));
	tempDirs.push(root);
	const cwd = join(root, "repo");
	const agentDir = join(root, "agent-home");
	await mkdir(join(cwd, ".millstrand"), { recursive: true });
	await mkdir(agentDir);
	execFileSync("git", ["init", "--quiet", cwd]);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("MILLSTRAND_RUN_ID", undefined);
	vi.stubEnv("MILLSTRAND_PI_PARENT_IDENTITY", undefined);
	return { cwd, agentDir };
}

beforeEach(() => {
	for (const name of inheritedGitEnvironmentNames) vi.stubEnv(name, undefined);
});

afterEach(async () => {
	runnerSession?.dispose();
	runnerSession = undefined;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("system-prompt startup rejection handling", () => {
	it("handles template rejection immediately while native registration is pending", async () => {
		const { cwd, agentDir } = await project();
		await writeFile(join(agentDir, "agent.njk"), "{% if invalid_template %}");
		let finishStrand!: () => void;
		const exec = vi.fn(async (command: string) => {
			if (command === "git") return { stdout: join(cwd, ".git"), stderr: "", code: 0 };
			return new Promise((resolve) => {
				finishStrand = () =>
					resolve({
						stdout: JSON.stringify({
							operation: "agent native-startup",
							identity: "delayed-template-beaver",
							"strand-id": "identity-1",
							"run-id": "run-1",
							result: "minted",
							instruction: "Use delayed-template-beaver for identity-bearing operations.",
						}),
						stderr: "",
						code: 0,
					});
			});
		});
		const handlers = new Map<string, (event: any, ctx: any) => any>();
		const emit = vi.fn();
		systemPromptExtension({
			events: { emit, on: vi.fn() },
			on: (name: string, handler: any) => handlers.set(name, handler),
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getFlag: () => false,
			getActiveTools: () => [],
			exec,
		} as any);
		const unhandledRejection = vi.fn();
		process.on("unhandledRejection", unhandledRejection);
		try {
			await expect(
				handlers.get("session_start")!(
					{},
					{
						cwd,
						hasUI: false,
						model: null,
						sessionManager: { getSessionId: () => "session-1" },
					},
				),
			).rejects.toThrow(/parseIf: expected/);
			expect(unhandledRejection).not.toHaveBeenCalled();
			expect(exec).toHaveBeenCalledWith(
				"strand",
				expect.arrayContaining(["agent", "native-startup"]),
				expect.anything(),
			);
		} finally {
			finishStrand();
			process.off("unhandledRejection", unhandledRejection);
		}
	});

	it.each(["down", "invalid-config", "invalid-response", "missing"] as const)(
		"keeps Pi usable without identity when Millstrand is %s",
		async (failure) => {
			const { cwd } = await project();
			if (failure === "missing") await rm(join(cwd, ".millstrand"), { recursive: true });
			const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
			const prompts: string[] = [];
			const strand = vi.fn(async () => ({
				stdout: failure === "invalid-response" ? "not JSON" : "",
				stderr: failure === "down" ? "Weaver unavailable" : "invalid config.json",
				code: failure === "invalid-response" ? 0 : 1,
				killed: false,
			}));
			runnerSession = await createTestSession({
				cwd,
				extensionFactories: [
					(pi: ExtensionAPI) => {
						const exec = pi.exec;
						pi.exec = (command, args, options) =>
							command === "strand" ? strand() : exec(command, args, options);
						systemPromptExtension(pi);
						pi.on("agent_start", (_event, ctx) => {
							prompts.push(ctx.getSystemPrompt());
						});
					},
				],
			});
			await runnerSession.run(when("ping", [says("pong")]));
			expect(prompts).toHaveLength(1);
			expect(prompts[0]).not.toContain('<system-reminder type="millstrand-identity">');
			expect(stderr).not.toHaveBeenCalled();
			expect(runnerSession.events.uiCallsFor("notify")).toEqual([]);
			expect(strand).toHaveBeenCalledTimes(failure === "missing" ? 0 : 1);
		},
	);
});

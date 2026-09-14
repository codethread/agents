import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestSession, type TestSession } from "@gaodes/pi-test-harness";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256CanonicalJson } from "../shared/strict-json.js";
import systemPromptExtension from "./index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fakeGuidanceStrand = join(
	packageRoot,
	"plugins/harness/.codex-plugin/conformance/fake-guidance-strand.mjs",
);
const managedEnvironmentNames = [
	"FAKE_GUIDANCE_LOG",
	"FAKE_GUIDANCE_MODE",
	"MILLSTRAND_MANAGED_BOOTSTRAP",
	"MILLSTRAND_MANAGED_GUIDANCE",
	"MILLSTRAND_PI_STRAND_BIN",
	"MILLSTRAND_RUN_ID",
	"PI_CODING_AGENT_DIR",
] as const;
const originalEnvironment = Object.fromEntries(
	managedEnvironmentNames.map((name) => [name, process.env[name]]),
);
const tempDirs: string[] = [];
let runnerSession: TestSession | undefined;

afterEach(async () => {
	runnerSession?.dispose();
	runnerSession = undefined;
	for (const name of managedEnvironmentNames) {
		const value = originalEnvironment[name];
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
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

	it("cancels prompts after the real runner catches invalid managed startup", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-managed-runner-startup-"));
		tempDirs.push(root);
		const cwd = join(root, "repo");
		const agentDir = join(root, "agent-home");
		await mkdir(cwd, { recursive: true });
		await mkdir(agentDir, { recursive: true });
		process.env.PI_CODING_AGENT_DIR = agentDir;
		process.env.MILLSTRAND_MANAGED_GUIDANCE = "{}";
		process.env.MILLSTRAND_MANAGED_BOOTSTRAP = "{}";

		runnerSession = await createTestSession({
			cwd,
			systemPrompt: "base prompt",
			extensionFactories: [systemPromptExtension],
		});
		const stream = vi.fn();
		runnerSession.session.agent.streamFn = stream;

		await runnerSession.session.prompt("must not reach the model");

		expect(stream).not.toHaveBeenCalled();
	});

	it("aborts the active provider boundary after the real runner catches an ack failure", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-managed-runner-handoff-"));
		tempDirs.push(root);
		const cwd = join(root, "repo");
		const workspace = join(cwd, ".millstrand");
		const agentDir = join(root, "agent-home");
		const logPath = join(root, "calls.jsonl");
		await mkdir(workspace, { recursive: true });
		await mkdir(agentDir, { recursive: true });
		process.env.PI_CODING_AGENT_DIR = agentDir;
		process.env.MILLSTRAND_PI_STRAND_BIN = fakeGuidanceStrand;
		process.env.FAKE_GUIDANCE_LOG = logPath;
		process.env.FAKE_GUIDANCE_MODE = "ack-ignored";

		const configureManagedLaunch = (pi: any) => {
			pi.on("session_start", (_event: unknown, ctx: any) => {
				const runId = "runner-ack-failure";
				const attempt = 1;
				const invocation = "runner-invocation";
				const identity = "runner-fixture-identity";
				const nativeSessionId = ctx.sessionManager.getSessionId();
				const context = {
					schema: "millstrand.agent-managed-context/v1",
					"identity-instruction": `Your Millstrand identity is ${identity}. Use ${identity} for identity-bearing operations; pass \`--by-identity ${identity}\` explicitly. Do not invent another identity.`,
					"appended-system-prompts": [
						"first frozen contribution",
						"intentionally repeated",
						"intentionally repeated",
					],
				};
				const guidance = {
					schema: "millstrand.agent-guidance-bootstrap/v1",
					transport: "native-v1",
					"run-id": runId,
					attempt,
					invocation,
					harness: "pi",
					"bundle-sha256": sha256CanonicalJson([runId, workspace, context]),
					"capability-sha256": "a".repeat(64),
				};
				const bootstrap = {
					schema: "millstrand.agent-managed-bootstrap/v1",
					"run-id": runId,
					harness: "pi",
					identity,
					"reservation-id": "runner-reservation",
					cwd,
					workspace,
					attempt,
					invocation,
					scope: "root",
					"expected-native-session-id": nativeSessionId,
				};
				process.env.MILLSTRAND_MANAGED_GUIDANCE = JSON.stringify(guidance);
				process.env.MILLSTRAND_MANAGED_BOOTSTRAP = JSON.stringify(bootstrap);
			});
		};

		runnerSession = await createTestSession({
			cwd,
			extensionFactories: [configureManagedLaunch, systemPromptExtension],
		});
		let providerRequests = 0;
		const provider = createServer((_request, response) => {
			providerRequests += 1;
			response.writeHead(500).end("managed failure reached the provider");
		});
		await new Promise<void>((resolvePromise, reject) => {
			provider.once("error", reject);
			provider.listen(0, "127.0.0.1", resolvePromise);
		});
		const address = provider.address();
		if (!address || typeof address === "string") throw new Error("test provider did not bind");
		runnerSession.session.agent.state.model = {
			...runnerSession.session.agent.state.model,
			baseUrl: `http://127.0.0.1:${address.port}/v1`,
		};
		const abort = vi.spyOn(runnerSession.session.agent, "abort");
		try {
			await runnerSession.session.prompt("must be cancelled");
			await runnerSession.session.agent.waitForIdle();
		} finally {
			await new Promise<void>((resolvePromise, reject) =>
				provider.close((error) => (error ? reject(error) : resolvePromise())),
			);
		}
		expect(abort).toHaveBeenCalledTimes(1);
		expect(providerRequests).toBe(0);
		expect(
			await runnerSession.session.extensionRunner.emitInput(
				"retry",
				undefined,
				"interactive",
				undefined,
			),
		).toEqual({ action: "handled" });

		const calls = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			calls.map((call) => call.operation.slice(0, 3)),
			JSON.stringify(calls),
		).toEqual([
			["agent", "startup", "pi"],
			["agent", "guidance", "acknowledge"],
			["agent", "guidance", "fail"],
		]);
	});
});

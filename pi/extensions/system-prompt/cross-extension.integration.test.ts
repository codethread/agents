import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { createEventBus, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnvironment = { ...process.env };
const inheritedGitEnvironmentNames = Object.keys(process.env).filter((name) =>
	name.startsWith("GIT_"),
);

async function writeExecutable(path: string, source: string): Promise<void> {
	await writeFile(path, source);
	await chmod(path, 0o755);
}

beforeEach(() => {
	for (const name of inheritedGitEnvironmentNames) vi.stubEnv(name, undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
	for (const name of Object.keys(process.env)) {
		if (!(name in originalEnvironment)) delete process.env[name];
	}
	Object.assign(process.env, originalEnvironment);
});

describe("Millstrand identity across separately loaded extensions", () => {
	it("shares session identity with child spawns while each project resolves its own workspace", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-millstrand-loader-"));
		try {
			const parentCwd = join(root, "parent");
			const childCwd = join(root, "child");
			const grandchildCwd = join(root, "grandchild");
			const workspace = join(parentCwd, ".millstrand");
			const childWorkspace = join(childCwd, ".millstrand");
			const grandchildWorkspace = join(grandchildCwd, ".millstrand");
			const bin = join(root, "bin");
			const childEnvironmentLog = join(root, "child-environments.tsv");
			const strandInvocationLog = join(root, "strand-invocations.tsv");
			await mkdir(join(root, ".pi", "agents"), { recursive: true });
			await Promise.all(
				[workspace, childWorkspace, grandchildWorkspace, bin].map((path) =>
					mkdir(path, { recursive: true }),
				),
			);
			for (const cwd of [parentCwd, childCwd, grandchildCwd])
				execFileSync("git", ["init", "--quiet", cwd]);
			const parentProcessCwd = await realpath(parentCwd);
			const childProcessCwd = await realpath(childCwd);
			const grandchildProcessCwd = await realpath(grandchildCwd);
			await writeFile(
				join(root, ".pi", "agents", "scout.md"),
				"---\nname: scout\ndescription: Test scout\ntools: read\n---\nYou are a test scout.\n",
			);
			await writeExecutable(
				join(bin, "strand"),
				`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const flag = name => args.includes(name) ? args[args.indexOf(name) + 1] : "";
const session = args[args.indexOf("native-startup") + 2];
const identity = session + "-identity";
fs.appendFileSync(process.env.STRAND_INVOCATION_LOG, [process.cwd(), flag("--workspace"), flag("--parent-identity"), session].join("\\t") + "\\n");
console.log(JSON.stringify({ operation: "agent native-startup", identity, "strand-id": "test-strand", "run-id": "test-run", result: "minted", instruction: "Use " + identity + " for identity-bearing operations." }));
`,
			);
			await writeExecutable(
				join(bin, "pi"),
				`#!/bin/sh
printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$PWD" "$MILLSTRAND_PI_PARENT_IDENTITY" "$MILLSTRAND_PI_WORKSPACE" "$MILLSTRAND_AGENT_ID" "$MILLSTRAND_RUN_ID" "$PI_SUBAGENT" >> "$CHILD_ENVIRONMENT_LOG"
printf '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}\\n'
`,
			);

			process.env.PATH = `${bin}${delimiter}${originalEnvironment.PATH ?? ""}`;
			process.env.PIES_DAEMON = "1";
			process.env.CHILD_ENVIRONMENT_LOG = childEnvironmentLog;
			process.env.STRAND_INVOCATION_LOG = strandInvocationLog;
			process.env.MILLSTRAND_AGENT_ID = "ambient-owner";
			process.env.MILLSTRAND_PI_PARENT_IDENTITY = "ancestor-parent";
			process.env.MILLSTRAND_PI_WORKSPACE = join(root, "ancestor-world");
			delete process.env.MILLSTRAND_RUN_ID;
			delete process.env.MILLSTRAND_MANAGED_BOOTSTRAP;
			delete process.env.MILLSTRAND_MANAGED_GUIDANCE;

			const loadPair = async (cwd: string) => {
				const eventBus = createEventBus();
				const loaded = await discoverAndLoadExtensions(
					[
						resolve("pi/extensions/system-prompt/index.ts"),
						resolve("pi/extensions/tools/subagent/index.ts"),
					],
					cwd,
					join(root, `agent-home-${basename(cwd)}`),
					eventBus,
				);
				expect(loaded.errors).toEqual([]);
				expect(loaded.extensions).toHaveLength(2);
				Object.assign(loaded.runtime, {
					getActiveTools: () => ["subagent"],
					getAllTools: () => [],
					getThinkingLevel: () => "low",
				});
				return { eventBus, loaded };
			};
			const modelRegistry = {
				find: (provider: string, id: string) => ({ provider, id }),
				getAll: () => [],
				hasConfiguredAuth: () => true,
			};
			const makeContext = (cwd: string, getSessionId: () => string) => ({
				cwd,
				hasUI: false,
				ui: { notify: () => undefined },
				sessionManager: { getSessionId, getSessionFile: () => undefined },
				modelRegistry,
				model: undefined,
				thinkingLevel: "low",
				getSystemPrompt: () => "base prompt",
			});
			type Pair = Awaited<ReturnType<typeof loadPair>>;
			type Context = ReturnType<typeof makeContext>;
			const start = async (
				pair: Pair,
				reason: "startup" | "reload" | "resume" | "new" | "fork",
				context: Context,
			) => {
				for (const extension of pair.loaded.extensions) {
					for (const handler of extension.handlers.get("session_start") ?? []) {
						await handler({ type: "session_start", reason }, context as never);
					}
				}
			};
			const materializePrompt = async (pair: Pair, context: Context) => {
				let systemPrompt = "base prompt";
				for (const extension of pair.loaded.extensions) {
					for (const handler of extension.handlers.get("before_agent_start") ?? []) {
						const result = await handler(
							{
								type: "before_agent_start",
								prompt: "test",
								systemPrompt,
								systemPromptOptions: {
									cwd: context.cwd,
									selectedTools: ["subagent"],
									toolSnippets: {},
									promptGuidelines: [],
								},
							},
							context as never,
						);
						if (
							typeof result === "object" &&
							result !== null &&
							"systemPrompt" in result &&
							typeof result.systemPrompt === "string"
						) {
							systemPrompt = result.systemPrompt;
						}
					}
				}
				return systemPrompt;
			};
			const getSubagentTool = (pair: Pair) =>
				pair.loaded.extensions
					.find((extension) => extension.tools.has("subagent"))
					?.tools.get("subagent")?.definition;

			const parent = await loadPair(parentCwd);
			let parentSessionId = "startup-session";
			const parentContext = makeContext(parentCwd, () => parentSessionId);
			const parentSubagentExtension = parent.loaded.extensions.find((extension) =>
				extension.tools.has("subagent"),
			);
			const parentSubagentTool = getSubagentTool(parent);
			expect(parentSubagentTool).toBeDefined();

			parent.eventBus.emit("codethread:millstrand-identity-context:v1", {
				identity: "stale-parent",
				instruction: "stale instruction",
				nativeSessionId: "stale-session",
			});
			parentSessionId = "replacement-session";
			await expect(
				parentSubagentExtension!.handlers.get("session_start")![0](
					{ type: "session_start", reason: "resume" },
					parentContext as never,
				),
			).rejects.toThrow("belongs to native session stale-session, not replacement-session");

			const lifecycles = [
				["startup", "parent-session", "ancestor-parent"],
				["reload", "parent-session", "ancestor-parent"],
				["resume", "parent-session", "ancestor-parent"],
				["new", "new-session", "parent-session-identity"],
				["fork", "fork-session", "new-session-identity"],
			] as const;
			for (const [reason, session] of lifecycles) {
				parentSessionId = session;
				await start(parent, reason, parentContext);
				const systemPrompt = await materializePrompt(parent, parentContext);
				expect(systemPrompt.match(/<system-reminder type="millstrand-identity">/g)).toHaveLength(1);
				expect(systemPrompt).toContain(`${parentSessionId}-identity`);

				await parentSubagentTool!.execute(
					`tool-${reason}`,
					{ agent: "scout", description: "test scout", task: "Inspect", cwd: childCwd },
					undefined,
					undefined,
					parentContext as never,
				);
			}

			process.env.MILLSTRAND_PI_PARENT_IDENTITY = "fork-session-identity";
			process.env.MILLSTRAND_PI_WORKSPACE = workspace;
			const child = await loadPair(childCwd);
			const childContext = makeContext(childCwd, () => "child-session");
			await start(child, "startup", childContext);
			const childPrompt = await materializePrompt(child, childContext);
			expect(childPrompt.match(/<system-reminder type="millstrand-identity">/g)).toHaveLength(1);
			expect(childPrompt).toContain("child-session-identity");
			const childSubagentTool = getSubagentTool(child);
			expect(childSubagentTool).toBeDefined();
			await childSubagentTool!.execute(
				"tool-grandchild",
				{ agent: "scout", description: "test scout", task: "Inspect", cwd: grandchildCwd },
				undefined,
				undefined,
				childContext as never,
			);

			process.env.MILLSTRAND_PI_PARENT_IDENTITY = "child-session-identity";
			process.env.MILLSTRAND_PI_WORKSPACE = workspace;
			const grandchild = await loadPair(grandchildCwd);
			const grandchildContext = makeContext(grandchildCwd, () => "grandchild-session");
			await start(grandchild, "startup", grandchildContext);
			const grandchildPrompt = await materializePrompt(grandchild, grandchildContext);
			expect(grandchildPrompt.match(/<system-reminder type="millstrand-identity">/g)).toHaveLength(
				1,
			);
			expect(grandchildPrompt).toContain("grandchild-session-identity");

			const childEnvironments = (await readFile(childEnvironmentLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => line.split("\t"));
			expect(childEnvironments).toEqual([
				...lifecycles.map(([, session]) => [
					childProcessCwd,
					`${session}-identity`,
					"",
					"",
					"",
					"1",
				]),
				[grandchildProcessCwd, "child-session-identity", "", "", "", "1"],
			]);

			const strandInvocations = (await readFile(strandInvocationLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => line.split("\t"));
			expect(strandInvocations).toEqual([
				...lifecycles.map(([, session, parentIdentity]) => [
					parentProcessCwd,
					join(parentProcessCwd, ".millstrand"),
					parentIdentity,
					session,
				]),
				[
					childProcessCwd,
					join(childProcessCwd, ".millstrand"),
					"fork-session-identity",
					"child-session",
				],
				[
					grandchildProcessCwd,
					join(grandchildProcessCwd, ".millstrand"),
					"child-session-identity",
					"grandchild-session",
				],
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

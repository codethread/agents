import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createEventBus, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const originalEnvironment = { ...process.env };

async function writeExecutable(path: string, source: string): Promise<void> {
	await writeFile(path, source);
	await chmod(path, 0o755);
}

afterEach(() => {
	for (const name of Object.keys(process.env)) {
		if (!(name in originalEnvironment)) delete process.env[name];
	}
	Object.assign(process.env, originalEnvironment);
});

describe("Millstrand identity across separately loaded extensions", () => {
	it("rebinds every native lifecycle and explicitly scopes child identity and workspace", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-millstrand-loader-"));
		try {
			const bin = join(root, "bin");
			const childEnvironmentLog = join(root, "child-environments.tsv");
			const workspace = join(root, "world", ".millstrand");
			await mkdir(join(root, ".pi", "agents"), { recursive: true });
			await mkdir(bin, { recursive: true });
			await mkdir(workspace, { recursive: true });
			await writeFile(
				join(root, ".pi", "agents", "scout.md"),
				"---\nname: scout\ndescription: Test scout\ntools: read\n---\nYou are a test scout.\n",
			);
			await writeExecutable(
				join(bin, "strand"),
				`#!/bin/sh
session=""
for argument in "$@"; do session="$argument"; done
identity="\${session}-identity"
printf '{"operation":"identity startup","identity":"%s","strand-id":"test-strand","result":"minted","instruction":"Use %s for identity-bearing operations."}\\n' "$identity" "$identity"
`,
			);
			await writeExecutable(
				join(bin, "pi"),
				`#!/bin/sh
printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$MILLSTRAND_PI_PARENT_IDENTITY" "$MILLSTRAND_PI_WORKSPACE" "$MILLSTRAND_AGENT_ID" "$MILLSTRAND_RUN_ID" "$PI_SUBAGENT" >> "$CHILD_ENVIRONMENT_LOG"
printf '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}\\n'
`,
			);

			process.env.PATH = `${bin}${delimiter}${originalEnvironment.PATH ?? ""}`;
			process.env.PIES_DAEMON = "1";
			process.env.CHILD_ENVIRONMENT_LOG = childEnvironmentLog;
			process.env.MILLSTRAND_AGENT_ID = "ambient-owner";
			process.env.MILLSTRAND_PI_PARENT_IDENTITY = "ancestor-parent";
			process.env.MILLSTRAND_PI_WORKSPACE = join(root, "ancestor-world");
			delete process.env.MILLSTRAND_RUN_ID;

			const eventBus = createEventBus();
			const loaded = await discoverAndLoadExtensions(
				[
					resolve("pi/extensions/system-prompt/index.ts"),
					resolve("pi/extensions/tools/subagent/index.ts"),
				],
				root,
				join(root, "agent-home"),
				eventBus,
			);
			expect(loaded.errors).toEqual([]);
			expect(loaded.extensions).toHaveLength(2);
			loaded.runtime.flagValues.set("millstrand-workspace", workspace);
			Object.assign(loaded.runtime, {
				getActiveTools: () => ["subagent"],
				getAllTools: () => [],
				getThinkingLevel: () => "low",
			});

			let nativeSessionId = "startup-session";
			const sessionManager = {
				getSessionId: () => nativeSessionId,
				getSessionFile: () => undefined,
			};
			const modelRegistry = {
				find: (provider: string, id: string) => ({ provider, id }),
				getAll: () => [],
				hasConfiguredAuth: () => true,
			};
			const context = {
				cwd: root,
				hasUI: false,
				ui: { notify: () => undefined },
				sessionManager,
				modelRegistry,
				model: undefined,
				thinkingLevel: "low",
				getSystemPrompt: () => "base prompt",
			};
			const subagentExtension = loaded.extensions.find((extension) =>
				extension.tools.has("subagent"),
			);
			const subagentTool = subagentExtension?.tools.get("subagent")?.definition;
			expect(subagentTool).toBeDefined();

			eventBus.emit("codethread:millstrand-identity-context:v1", {
				identity: "stale-parent",
				instruction: "stale instruction",
				nativeSessionId: "stale-session",
			});
			nativeSessionId = "replacement-session";
			await expect(
				subagentExtension!.handlers.get("session_start")![0](
					{ type: "session_start", reason: "resume" },
					context as never,
				),
			).rejects.toThrow("belongs to native session stale-session, not replacement-session");

			for (const reason of ["startup", "reload", "resume", "new", "fork"] as const) {
				nativeSessionId = `${reason}-session`;
				for (const extension of loaded.extensions) {
					for (const handler of extension.handlers.get("session_start") ?? []) {
						await handler({ type: "session_start", reason }, context as never);
					}
				}

				let systemPrompt = "base prompt";
				for (const extension of loaded.extensions) {
					for (const handler of extension.handlers.get("before_agent_start") ?? []) {
						const result = await handler(
							{
								type: "before_agent_start",
								prompt: "test",
								systemPrompt,
								systemPromptOptions: {
									cwd: root,
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
				expect(systemPrompt.match(/<system-reminder type="millstrand-identity">/g)).toHaveLength(1);
				expect(systemPrompt).toContain(`${nativeSessionId}-identity`);

				await subagentTool!.execute(
					`tool-${reason}`,
					{ agent: "scout", description: "test scout", task: "Inspect", cwd: root },
					undefined,
					undefined,
					context as never,
				);
			}

			const childEnvironments = (await readFile(childEnvironmentLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => line.split("\t"));
			expect(childEnvironments).toEqual(
				["startup", "reload", "resume", "new", "fork"].map((reason) => [
					`${reason}-session-identity`,
					workspace,
					"",
					"",
					"1",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

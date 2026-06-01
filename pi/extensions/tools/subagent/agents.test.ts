import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	discoverAgents,
	findAgentByName,
	findDelegationTarget,
	formatAgentsForPrompt,
	formatSelectedAgentPrompt,
	getAgentRuntimeSettings,
	getAgentActiveTools,
	getInheritedAgentRuntimeSettings,
	parseAgentFlagCliOverrides,
	resolveAgentModelCandidate,
	validateAgentModelPolicies,
	type AgentConfig,
	type SwarmConfig,
} from "./agents.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf-8");
}

function makeAgentConfig(overrides: Partial<AgentConfig> & Pick<AgentConfig, "name">): AgentConfig {
	const { name, ...rest } = overrides;
	return {
		name,
		description: `${name} specialist`,
		hidden: false,
		tools: [],
		systemPrompt: `You are ${name}.`,
		source: "package",
		filePath: `/tmp/${name}.md`,
		...rest,
	};
}

function writeAgent(
	dir: string,
	fileName: string,
	params: {
		name: string;
		description: string;
		meta?: string;
		hidden?: boolean;
		tools?: string;
		model?: string;
		body?: string;
	},
): string {
	const parts = [
		"---",
		`name: ${params.name}`,
		`description: ${params.description}`,
		...(params.meta ? [`meta: ${params.meta}`] : []),
		...(params.hidden ? ["hidden: true"] : []),
		...(params.tools ? [`tools: ${params.tools}`] : []),
		...(params.model ? [`model: ${params.model}`] : []),
		"---",
		"",
		params.body ?? `You are ${params.name}.`,
		"",
	];
	const filePath = path.join(dir, fileName);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, parts.join("\n"), "utf-8");
	return filePath;
}

function writeSwarm(
	dir: string,
	folderName: string,
	config: {
		name: string;
		description: string;
		members: string[];
		hidden?: boolean;
	},
): string {
	const filePath = path.join(dir, folderName, "swarm.json");
	writeJson(filePath, {
		name: config.name,
		description: config.description,
		members: config.members,
		...(config.hidden ? { hidden: true } : {}),
	});
	return filePath;
}

function writeRawAgent(dir: string, fileName: string, content: string): string {
	const filePath = path.join(dir, fileName);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
}

describe("formatAgentsForPrompt", () => {
	it("returns an empty string when no subagents are available", () => {
		expect(formatAgentsForPrompt([])).toBe("");
	});

	it("formats visible subagents as an indented tool catalog with escaped names and descriptions", () => {
		const agents: AgentConfig[] = [
			{
				name: "alpha",
				description: "General-purpose helper",
				hidden: false,
				tools: [],
				systemPrompt: "prompt",
				source: "package",
				filePath: "/tmp/alpha.md",
			},
			{
				name: "beta <fast>",
				description: "Map dirs & files > summarize",
				hidden: true,
				tools: [],
				systemPrompt: "prompt",
				source: "user",
				filePath: "/tmp/beta.md",
			},
		];

		expect(formatAgentsForPrompt(agents)).toBe(
			[
				"  These are the available subagents with their intended use.",
				"  ",
				"  <available-subagents>",
				"    <subagent>",
				"      <name>alpha</name>",
				"      <description>General-purpose helper</description>",
				"    </subagent>",
				"  </available-subagents>",
			].join("\n"),
		);
	});

	it("includes visible swarms alongside agents with XML escaping and omits hidden swarms", () => {
		const agents: AgentConfig[] = [
			{
				name: "alpha",
				description: "General-purpose helper",
				hidden: false,
				tools: [],
				systemPrompt: "prompt",
				source: "package",
				filePath: "/tmp/alpha.md",
			},
		];
		const swarms: SwarmConfig[] = [
			{
				name: "panel & review",
				description: "<team> checks",
				hidden: false,
				members: ["alpha"],
				source: "user",
				filePath: "/tmp/swarms/panel/swarm.json",
			},
			{
				name: "hidden-swarm",
				description: "Team behind the scenes",
				hidden: true,
				members: ["alpha"],
				source: "project",
				filePath: "/tmp/swarms/hidden/swarm.json",
			},
		];

		expect(formatAgentsForPrompt(agents, swarms)).toBe(
			[
				"  These are the available subagents with their intended use.",
				"  ",
				"  <available-subagents>",
				"    <subagent>",
				"      <name>alpha</name>",
				"      <description>General-purpose helper</description>",
				"    </subagent>",
				"    <subagent>",
				"      <name>panel &amp; review</name>",
				"      <description>&lt;team&gt; checks</description>",
				"    </subagent>",
				"  </available-subagents>",
			].join("\n"),
		);
	});

	it("returns an empty string when only hidden agents exist", () => {
		const agents: AgentConfig[] = [
			{
				name: "hidden-agent",
				description: "Secret helper",
				hidden: true,
				tools: [],
				systemPrompt: "prompt",
				source: "package",
				filePath: "/tmp/hidden-agent.md",
			},
		];

		expect(
			formatAgentsForPrompt(agents, [
				{
					name: "hidden-swarm",
					description: "Hidden review",
					hidden: true,
					members: ["hidden-agent"],
					source: "package",
					filePath: "/tmp/hidden-swarm/swarm.json",
				},
			]),
		).toBe("");
	});
});

describe("getAgentRuntimeSettings", () => {
	it("parses model ref and thinking level from the agent model field", () => {
		const agent: AgentConfig = {
			name: "fixer",
			description: "Implementation agent",
			hidden: false,
			tools: ["read", "edit"],
			model: "openai-codex/gpt-5.4-mini:high",
			systemPrompt: "You are fixer.",
			source: "package",
			filePath: "/tmp/fixer.md",
		};

		expect(getAgentRuntimeSettings(agent)).toEqual({
			tools: ["read", "edit"],
			modelFlagValue: "openai-codex/gpt-5.4-mini:high",
			modelRef: "openai-codex/gpt-5.4-mini",
			thinkingLevel: "high",
			systemPrompt: "You are fixer.",
		});
	});

	it("treats non-thinking suffixes as part of the model string", () => {
		const agent: AgentConfig = {
			name: "custom",
			description: "Custom model agent",
			hidden: false,
			tools: [],
			model: "custom-provider/model:preview",
			systemPrompt: "You are custom.",
			source: "user",
			filePath: "/tmp/custom.md",
		};

		expect(getAgentRuntimeSettings(agent)).toEqual({
			tools: [],
			modelFlagValue: "custom-provider/model:preview",
			modelRef: "custom-provider/model:preview",
			systemPrompt: "You are custom.",
		});
	});
});

describe("parseAgentFlagCliOverrides", () => {
	it("detects model, provider, thinking, and tools overrides", () => {
		expect(
			parseAgentFlagCliOverrides([
				"--agent",
				"scout",
				"--model",
				"openai/gpt-5.4-nano:off",
				"--thinking=medium",
				"--tools=read,bash",
			]),
		).toEqual({
			hasModelOverride: true,
			hasThinkingOverride: true,
			hasToolsOverride: true,
		});

		expect(
			parseAgentFlagCliOverrides(["--agent", "scout", "-m", "openai/gpt-5.4-nano:off"]),
		).toEqual({
			hasModelOverride: true,
			hasThinkingOverride: false,
			hasToolsOverride: false,
		});

		expect(
			parseAgentFlagCliOverrides(["--agent", "scout", "--provider", "openai", "--no-tools"]),
		).toEqual({
			hasModelOverride: true,
			hasThinkingOverride: false,
			hasToolsOverride: true,
		});
	});
});

describe("getAgentActiveTools", () => {
	it("treats the inherited tool list as the exact active set across built-in and custom extension tools", () => {
		expect(
			getAgentActiveTools(
				["read", "custom-tool"],
				[
					{ name: "read", sourceInfo: { source: "builtin" } },
					{ name: "bash", sourceInfo: { source: "builtin" } },
					{ name: "custom-tool", sourceInfo: { source: "/repo/custom-tool.ts" } },
					{ name: "subagent", sourceInfo: { source: "/repo/subagent.ts" } },
				],
			),
		).toEqual(["read", "custom-tool"]);
	});

	it("filters out requested tools that are not actually available in the runtime", () => {
		expect(
			getAgentActiveTools(
				["read", "missing-tool", "subagent"],
				[
					{ name: "read", sourceInfo: { source: "builtin" } },
					{ name: "subagent", sourceInfo: { source: "/repo/subagent.ts" } },
				],
			),
		).toEqual(["read", "subagent"]);
	});
});

describe("getInheritedAgentRuntimeSettings", () => {
	it("keeps inheriting fields that were not overridden explicitly", () => {
		const agent: AgentConfig = {
			name: "scout",
			description: "Recon agent",
			hidden: false,
			tools: ["read", "bash"],
			model: "openai-codex/gpt-5.4-mini:low",
			systemPrompt: "You are scout.",
			source: "package",
			filePath: "/tmp/scout.md",
		};

		expect(
			getInheritedAgentRuntimeSettings(agent, {
				hasModelOverride: true,
				hasThinkingOverride: false,
				hasToolsOverride: true,
			}),
		).toEqual({
			systemPrompt: "You are scout.",
			tools: undefined,
			modelFlagValue: undefined,
			modelRef: undefined,
			thinkingLevel: undefined,
		});
	});
});

describe("formatSelectedAgentPrompt", () => {
	it("returns the agent prompt inside a separating XML wrapper", () => {
		const agent: AgentConfig = {
			name: "scout",
			description: "Recon agent",
			hidden: false,
			tools: [],
			systemPrompt: "You are scout.\nStay concise.",
			source: "package",
			filePath: "/tmp/scout.md",
		};

		expect(formatSelectedAgentPrompt(agent)).toBe(
			'\n\n<system-reminder type="selected-agent-prompt">\nYou are scout.\nStay concise.\n</system-reminder>',
		);
	});

	it("returns an empty string for missing or blank prompts", () => {
		expect(formatSelectedAgentPrompt(undefined)).toBe("");
		expect(
			formatSelectedAgentPrompt({
				name: "blank",
				description: "Blank agent",
				hidden: false,
				tools: [],
				systemPrompt: " \n\t ",
				source: "user",
				filePath: "/tmp/blank.md",
			}),
		).toBe("");
	});
});

describe("findDelegationTarget", () => {
	it("finds agent and swarm targets by trimmed name", () => {
		const root = makeTempDir("subagent-find-delegation-target-");
		const userAgentsDir = path.join(root, "user-agents");
		const userSwarmsDir = path.join(root, "user-swarms");
		const cwd = path.join(root, "workspace");

		writeAgent(userAgentsDir, "alpha.md", {
			name: "alpha",
			description: "Agent alpha",
		});
		writeSwarm(userSwarmsDir, "team", {
			name: "team",
			description: "Agent team",
			members: ["alpha"],
		});

		const discovery = discoverAgents(cwd, {
			packageAgentsDir: path.join(root, "package-agents"),
			userAgentsDir,
			projectAgentsDir: null,
			packageSwarmsDir: null,
			userSwarmsDir,
			projectSwarmsDir: null,
			settingsPath: null,
		});

		expect(findDelegationTarget(discovery, " alpha ")).toMatchObject({
			kind: "agent",
			agent: expect.objectContaining({ name: "alpha" }),
		});
		expect(findDelegationTarget(discovery, "team")).toMatchObject({
			kind: "swarm",
			swarm: expect.objectContaining({ name: "team" }),
		});
		expect(findDelegationTarget(discovery, " \t ")).toBeUndefined();
	});
});

describe("model policy validation", () => {
	const modelRegistry = {
		find: (provider: string, model: string) =>
			provider === "openai" && ["gpt-5.4-mini", "gpt-5.4", "no-auth"].includes(model)
				? { provider, id: model }
				: undefined,
		getAll: () => [
			{ provider: "openai", id: "gpt-5.4-mini" },
			{ provider: "openai", id: "gpt-5.4" },
			{ provider: "openai", id: "no-auth" },
		],
		hasConfiguredAuth: (model: unknown) =>
			typeof model === "object" && model !== null && "id" in model && model.id !== "no-auth",
	};

	it("reports malformed and unavailable declared policies while omitted model inherits", () => {
		const agents: AgentConfig[] = [
			makeAgentConfig({ name: "omitted", model: undefined, modelCandidates: undefined }),
			makeAgentConfig({
				name: "bad-config",
				modelPolicyError: "Invalid model policy for bad-config",
			}),
			makeAgentConfig({
				name: "unavailable",
				model: "deepseek/deepseek-v4:high",
				modelCandidates: [{ id: "deepseek/deepseek-v4:high" }],
			}),
			makeAgentConfig({
				name: "no-auth",
				model: "openai/no-auth:low",
				modelCandidates: [{ id: "openai/no-auth:low" }],
			}),
			makeAgentConfig({
				name: "valid",
				model: "gpt-5.4-mini:low",
				modelCandidates: [{ id: "gpt-5.4-mini:low" }],
			}),
		];

		const errors = validateAgentModelPolicies(agents, modelRegistry);

		expect(errors).toHaveLength(3);
		expect(errors[0]).toBe("Invalid model policy for bad-config");
		expect(errors[1]).toContain('agent "unavailable"');
		expect(errors[1]).toContain("/tmp/unavailable.md");
		expect(errors[1]).toContain('candidate "deepseek/deepseek-v4" is not available');
		expect(errors[2]).toContain('agent "no-auth"');
		expect(errors[2]).toContain("has no configured API key/auth");
	});

	it("resolves unique bare model ids through the same registry path used by direct mode", () => {
		expect(resolveAgentModelCandidate("gpt-5.4-mini:low", modelRegistry)).toMatchObject({
			model: { provider: "openai", id: "gpt-5.4-mini" },
			modelRef: "gpt-5.4-mini",
		});
	});

	it("uses first valid declared candidate and candidate-local thinking unless CLI overrides", () => {
		const agent = makeAgentConfig({
			name: "selector",
			model: "missing/model:high",
			modelCandidates: [
				{ id: "missing/model:high" },
				{ id: "openai/gpt-5.4-mini:low" },
				{ id: "openai/gpt-5.4:high" },
			],
		});

		expect(
			getInheritedAgentRuntimeSettings(
				agent,
				{ hasModelOverride: false, hasThinkingOverride: false, hasToolsOverride: false },
				modelRegistry,
			),
		).toMatchObject({
			modelFlagValue: "openai/gpt-5.4-mini:low",
			modelRef: "openai/gpt-5.4-mini",
			thinkingLevel: "low",
		});
		const modelOverrideSettings = getInheritedAgentRuntimeSettings(
			agent,
			{ hasModelOverride: true, hasThinkingOverride: false, hasToolsOverride: false },
			modelRegistry,
		);
		expect(modelOverrideSettings.modelFlagValue).toBeUndefined();
		expect(modelOverrideSettings.thinkingLevel).toBeUndefined();
		expect(
			getInheritedAgentRuntimeSettings(
				agent,
				{ hasModelOverride: false, hasThinkingOverride: true, hasToolsOverride: false },
				modelRegistry,
			).thinkingLevel,
		).toBeUndefined();
	});
});

describe("discoverAgents", () => {
	it("discovers agents from temp package, user, and project dirs with override precedence", () => {
		const root = makeTempDir("subagent-discovery-");
		const packageAgentsDir = path.join(root, "package-agents");
		const userAgentsDir = path.join(root, "user-agents");
		const projectAgentsDir = path.join(root, ".pi", "agents");
		const settingsPath = path.join(root, ".pi", "settings.json");
		const cwd = path.join(root, "apps", "web");

		writeJson(settingsPath, {
			defaultProvider: "openai",
			defaultModel: "gpt-5.4",
			enabledModels: ["openai/gpt-5.4", "openai-codex/gpt-5.4-mini"],
		});

		const packageAgentPath = writeAgent(packageAgentsDir, "alpha.md", {
			name: "alpha",
			description: "Package agent",
			tools: "Read, Bash, WebSearch",
			model: "sonnet",
		});
		writeAgent(packageAgentsDir, "shared.md", {
			name: "shared",
			description: "Package version",
			body: "Package body",
		});
		const userAgentPath = writeAgent(userAgentsDir, "shared.md", {
			name: "shared",
			description: "User version",
			body: "User body",
		});
		writeAgent(userAgentsDir, "gamma.md", {
			name: "gamma",
			description: "User-only agent",
			tools: "Glob, Custom-Tool, Subagent",
		});
		const projectAgentPath = writeAgent(projectAgentsDir, "shared.md", {
			name: "shared",
			description: "Project version",
			tools: "glob, multiedit",
			body: "Project body",
		});

		const discovery = discoverAgents(cwd, {
			packageAgentsDir,
			userAgentsDir,
			projectAgentsDir,
			packageSwarmsDir: null,
			settingsPath,
		});

		expect(discovery.projectAgentsDir).toBe(projectAgentsDir);
		expect(discovery.userAgents.map((agent) => agent.name).sort()).toEqual(["gamma", "shared"]);
		expect(discovery.projectAgents.map((agent) => agent.name)).toEqual(["shared"]);

		const byName = new Map(discovery.agents.map((agent) => [agent.name, agent]));
		expect([...byName.keys()].sort()).toEqual(["alpha", "gamma", "shared"]);

		expect(byName.get("alpha")).toMatchObject({
			source: "package",
			filePath: packageAgentPath,
			hidden: false,
			tools: ["read", "bash"],
			model: "sonnet",
			modelCandidates: [{ id: "sonnet" }],
		});
		expect(byName.get("gamma")).toMatchObject({
			source: "user",
			hidden: false,
			tools: ["find", "custom-tool", "subagent"],
		});
		expect(byName.get("shared")).toMatchObject({
			source: "project",
			filePath: projectAgentPath,
			hidden: false,
			description: "Project version",
			systemPrompt: "Project body",
			tools: ["find", "edit"],
		});
		expect(byName.get("shared")?.filePath).not.toBe(userAgentPath);
		expect(findAgentByName(discovery.agents, " shared ")).toMatchObject({
			source: "project",
			filePath: projectAgentPath,
		});
	});

	it("parses model policy strings, objects, gated lists, deduplication, and omitted inheritance", () => {
		const root = makeTempDir("subagent-model-policy-");
		const packageAgentsDir = path.join(root, "package-agents");
		const cwd = path.join(root, "workspace");

		writeAgent(packageAgentsDir, "string.md", {
			name: "string-model",
			description: "String model",
			model: "openai/gpt-5.4-mini:low",
		});
		writeRawAgent(
			packageAgentsDir,
			"object.md",
			`---
name: object-model
description: Object model
model:
  id: deepseek/deepseek-v4:high
  when: " $WORK_PROFILE == 'home' "
---
Object body.
`,
		);
		writeRawAgent(
			packageAgentsDir,
			"mixed.md",
			`---
name: mixed-model
description: Mixed model
model:
  - openai/gpt-5.4-mini:low
  - id: ignored/model
    when: "$DISABLED"
  - id: openai/gpt-5.4-mini:low
  - id: openai/gpt-5.4:high
    when: '$WORK_PROFILE != "office"'
---
Mixed body.
`,
		);
		writeAgent(packageAgentsDir, "omitted.md", {
			name: "omitted-model",
			description: "Omitted model",
		});

		const discovery = discoverAgents(cwd, {
			packageAgentsDir,
			userAgentsDir: path.join(root, "user-agents"),
			projectAgentsDir: null,
			packageSwarmsDir: null,
			settingsPath: null,
			env: { WORK_PROFILE: "home", DISABLED: "" },
		});
		const byName = new Map(discovery.agents.map((agent) => [agent.name, agent]));

		expect(byName.get("string-model")).toMatchObject({
			model: "openai/gpt-5.4-mini:low",
			modelCandidates: [{ id: "openai/gpt-5.4-mini:low" }],
		});
		expect(byName.get("object-model")).toMatchObject({
			model: "deepseek/deepseek-v4:high",
			modelCandidates: [{ id: "deepseek/deepseek-v4:high" }],
		});
		expect(byName.get("mixed-model")?.modelCandidates).toEqual([
			{ id: "openai/gpt-5.4-mini:low" },
			{ id: "openai/gpt-5.4:high" },
		]);
		expect(byName.get("omitted-model")?.model).toBeUndefined();
		expect(byName.get("omitted-model")?.modelCandidates).toBeUndefined();
	});

	it("treats false-like env values as false without trimming comparison values", () => {
		const root = makeTempDir("subagent-model-policy-env-");
		const packageAgentsDir = path.join(root, "package-agents");
		const cwd = path.join(root, "workspace");

		writeRawAgent(
			packageAgentsDir,
			"env.md",
			`---
name: env-model
description: Env model
model:
  - id: false-is-skipped
    when: "$FLAG"
  - id: negated-false-is-included
    when: "!$FLAG"
  - id: raw-comparison
    when: "$RAW == ' value '"
---
Env body.
`,
		);

		const discovery = discoverAgents(cwd, {
			packageAgentsDir,
			userAgentsDir: path.join(root, "user-agents"),
			projectAgentsDir: null,
			packageSwarmsDir: null,
			settingsPath: null,
			env: { FLAG: "false", RAW: " value " },
		});

		expect(discovery.agents[0]?.modelCandidates).toEqual([
			{ id: "negated-false-is-included" },
			{ id: "raw-comparison" },
		]);
	});

	it("records model-policy config errors per agent", () => {
		const root = makeTempDir("subagent-model-policy-errors-");
		const packageAgentsDir = path.join(root, "package-agents");
		const cwd = path.join(root, "workspace");

		writeRawAgent(
			packageAgentsDir,
			"empty-list.md",
			`---
name: empty-list
description: Empty list
model: []
---
Body.
`,
		);
		writeRawAgent(
			packageAgentsDir,
			"unknown-key.md",
			`---
name: unknown-key
description: Unknown key
model:
  id: model-a
  extra: nope
---
Body.
`,
		);
		writeRawAgent(
			packageAgentsDir,
			"blank-id.md",
			`---
name: blank-id
description: Blank id
model:
  id: "   "
---
Body.
`,
		);
		writeRawAgent(
			packageAgentsDir,
			"bad-when.md",
			`---
name: bad-when
description: Bad when
model:
  id: model-a
  when: "$1BAD"
---
Body.
`,
		);
		writeRawAgent(
			packageAgentsDir,
			"missing-id.md",
			`---
name: missing-id
description: Missing id
model:
  when: "$HOME_PROFILE"
---
Body.
`,
		);
		writeRawAgent(
			packageAgentsDir,
			"gated-out.md",
			`---
name: gated-out
description: Gated out
model:
  - id: model-a
    when: "!$HOME_PROFILE"
---
Body.
`,
		);
		writeAgent(packageAgentsDir, "valid.md", {
			name: "valid",
			description: "Valid agent",
			model: "model-b",
		});

		const discovery = discoverAgents(cwd, {
			packageAgentsDir,
			userAgentsDir: path.join(root, "user-agents"),
			projectAgentsDir: null,
			packageSwarmsDir: null,
			settingsPath: null,
			env: { HOME_PROFILE: "1" },
		});
		const byName = new Map(discovery.agents.map((agent) => [agent.name, agent]));

		expect(byName.get("valid")?.modelPolicyError).toBeUndefined();
		expect(byName.get("empty-list")?.modelPolicyError).toContain("model list must not be empty");
		expect(byName.get("unknown-key")?.modelPolicyError).toContain("unknown key(s): extra");
		expect(byName.get("blank-id")?.modelPolicyError).toContain("id must be a non-empty string");
		expect(byName.get("bad-when")?.modelPolicyError).toContain(
			'unsupported when expression "$1BAD"',
		);
		expect(byName.get("missing-id")?.modelPolicyError).toContain("id must be a non-empty string");
		expect(byName.get("gated-out")?.modelPolicyError).toContain(
			"leaves no candidates after gating",
		);
		for (const name of [
			"empty-list",
			"unknown-key",
			"blank-id",
			"bad-when",
			"missing-id",
			"gated-out",
		]) {
			expect(byName.get(name)?.modelPolicyError).toMatch(/Invalid model policy/);
			expect(byName.get(name)?.modelCandidates).toBeUndefined();
		}
	});

	it("discovers swarms across package, user, and project dirs with source precedence", () => {
		const root = makeTempDir("subagent-swarms-precedence-");
		const packageAgentsDir = path.join(root, "package-agents");
		const userAgentsDir = path.join(root, "user-agents");
		const projectAgentsDir = path.join(root, ".pi", "agents");
		const packageSwarmsDir = path.join(root, "package-swarms");
		const userSwarmsDir = path.join(root, "user-swarms");
		const projectSwarmsDir = path.join(root, ".pi", "swarms");
		const cwd = path.join(root, "apps", "web");

		writeAgent(packageAgentsDir, "alpha.md", {
			name: "alpha",
			description: "Package agent",
			tools: "Read, Bash",
		});
		writeAgent(userAgentsDir, "beta.md", {
			name: "beta",
			description: "User beta specialist",
		});
		writeAgent(projectAgentsDir, "gamma.md", {
			name: "gamma",
			description: "Project gamma specialist",
		});
		writeAgent(projectAgentsDir, "delta.md", {
			name: "delta",
			description: "Project delta specialist",
		});
		writeSwarm(packageSwarmsDir, "review", {
			name: "review",
			description: "Package review panel",
			members: ["alpha", "beta"],
		});
		writeSwarm(packageSwarmsDir, "audit", {
			name: "audit",
			description: "Package audit panel",
			members: ["alpha"],
		});
		writeSwarm(userSwarmsDir, "review", {
			name: "review",
			description: "User review panel",
			members: ["beta", "alpha"],
		});
		writeSwarm(projectSwarmsDir, "review", {
			name: "review",
			description: "Project review panel",
			members: ["gamma", "delta", "alpha"],
		});

		const discovery = discoverAgents(cwd, {
			packageAgentsDir,
			userAgentsDir,
			projectAgentsDir,
			packageSwarmsDir,
			userSwarmsDir,
			projectSwarmsDir,
			settingsPath: null,
		});

		expect(discovery.swarms.map((swarm) => swarm.name).sort()).toEqual(["audit", "review"]);
		expect(discovery.userSwarms.map((swarm) => swarm.name)).toEqual(["review"]);
		expect(discovery.projectSwarms.map((swarm) => swarm.name)).toEqual(["review"]);
		expect(discovery.projectSwarmsDir).toBe(projectSwarmsDir);

		const byName = new Map(discovery.swarms.map((swarm) => [swarm.name, swarm]));
		expect(byName.get("review")).toMatchObject({
			source: "project",
			description: "Project review panel",
			hidden: false,
			members: ["gamma", "delta", "alpha"],
		});
		expect(byName.get("audit")).toMatchObject({
			source: "package",
			description: "Package audit panel",
			hidden: false,
		});
	});

	it("loads agents defined in swarm folders before resolving swarm discovery", () => {
		const root = makeTempDir("subagent-swarms-agents-");
		const userAgentsDir = path.join(root, "user-agents");
		const userSwarmsDir = path.join(root, "user-swarms");
		const cwd = path.join(root, "workspace");

		writeAgent(userSwarmsDir, path.join("review", "security-review.md"), {
			name: "security-review",
			description: "Security review specialist",
			body: "You are security-review.",
		});
		writeAgent(userSwarmsDir, path.join("review", "correctness-review.md"), {
			name: "correctness-review",
			description: "Correctness review specialist",
			body: "You are correctness-review.",
		});
		const swarmPath = writeSwarm(userSwarmsDir, "review", {
			name: "review",
			description: "Project review panel",
			members: ["correctness-review", "security-review"],
		});

		const discovery = discoverAgents(cwd, {
			packageAgentsDir: path.join(root, "package-agents"),
			userAgentsDir,
			projectAgentsDir: null,
			packageSwarmsDir: null,
			userSwarmsDir,
			projectSwarmsDir: null,
			settingsPath: null,
		});

		const byName = new Map(discovery.agents.map((agent) => [agent.name, agent]));
		expect(byName.get("security-review")).toMatchObject({
			source: "user",
			description: "Security review specialist",
			filePath: path.join(userSwarmsDir, "review", "security-review.md"),
		});
		expect(byName.get("correctness-review")).toMatchObject({
			source: "user",
			description: "Correctness review specialist",
			filePath: path.join(userSwarmsDir, "review", "correctness-review.md"),
		});
		expect(discovery.swarms).toEqual([
			{
				name: "review",
				description: "Project review panel",
				hidden: false,
				members: ["correctness-review", "security-review"],
				source: "user",
				filePath: swarmPath,
			},
		]);
	});

	it("ignores author-only meta frontmatter during discovery and prompt formatting", () => {
		const root = makeTempDir("subagent-meta-");
		const packageAgentsDir = path.join(root, "package-agents");
		const cwd = path.join(root, "workspace");

		writeAgent(packageAgentsDir, "scout.md", {
			name: "scout",
			description: "Recon agent",
			meta: "Author-only rationale that should never reach runtime output",
			tools: "Read, Bash",
			body: "You are scout.",
		});

		const discovery = discoverAgents(cwd, {
			packageAgentsDir,
			userAgentsDir: path.join(root, "user-agents"),
			projectAgentsDir: null,
			packageSwarmsDir: null,
			settingsPath: null,
		});

		expect(discovery.agents).toHaveLength(1);
		expect(discovery.agents[0]).toMatchObject({
			name: "scout",
			description: "Recon agent",
			hidden: false,
			tools: ["read", "bash"],
			systemPrompt: "You are scout.",
		});
		expect(formatAgentsForPrompt(discovery.agents)).not.toContain("Author-only rationale");
		expect(formatAgentsForPrompt(discovery.agents)).not.toContain("meta");
	});

	it("keeps hidden agents discoverable by name while omitting them from prompt inventory", () => {
		const root = makeTempDir("subagent-hidden-");
		const packageAgentsDir = path.join(root, "package-agents");
		const cwd = path.join(root, "workspace");

		writeAgent(packageAgentsDir, "visible.md", {
			name: "visible",
			description: "Visible agent",
			body: "You are visible.",
		});
		writeAgent(packageAgentsDir, "hidden.md", {
			name: "hidden-agent",
			description: "Hidden agent",
			hidden: true,
			body: "You are hidden.",
		});

		const discovery = discoverAgents(cwd, {
			packageAgentsDir,
			userAgentsDir: path.join(root, "user-agents"),
			projectAgentsDir: null,
			packageSwarmsDir: null,
			settingsPath: null,
		});

		expect(
			discovery.agents
				.map((agent) => [agent.name, agent.hidden] as const)
				.sort(([left], [right]) => left.localeCompare(right)),
		).toEqual([
			["hidden-agent", true],
			["visible", false],
		]);
		expect(findAgentByName(discovery.agents, "hidden-agent")).toMatchObject({
			name: "hidden-agent",
			hidden: true,
			systemPrompt: "You are hidden.",
		});
		const promptInventory = formatAgentsForPrompt(discovery.agents);
		expect(promptInventory).toContain("<name>visible</name>");
		expect(promptInventory).not.toContain("hidden-agent");
	});

	it("can run entirely against temp dirs without loading bundled repo agents", () => {
		const root = makeTempDir("subagent-isolation-");
		const packageAgentsDir = path.join(root, "package-agents");
		const userAgentsDir = path.join(root, "user-agents");
		const cwd = path.join(root, "workspace");

		writeAgent(packageAgentsDir, "temp-package.md", {
			name: "temp-package",
			description: "Temp package agent",
		});
		writeAgent(userAgentsDir, "temp-user.md", {
			name: "temp-user",
			description: "Temp user agent",
		});

		const discovery = discoverAgents(cwd, {
			packageAgentsDir,
			userAgentsDir,
			projectAgentsDir: null,
			packageSwarmsDir: null,
			settingsPath: null,
		});

		expect(discovery.projectAgentsDir).toBeNull();
		expect(discovery.projectAgents).toEqual([]);
		expect(discovery.agents.map((agent) => agent.name).sort()).toEqual([
			"temp-package",
			"temp-user",
		]);
		for (const agent of discovery.agents) {
			expect(agent.hidden).toBe(false);
			expect(agent.tools).toEqual([]);
		}
	});

	it("throws when an effective agent and swarm share a name", () => {
		const root = makeTempDir("subagent-collision-");
		const packageAgentsDir = path.join(root, "package-agents");
		const packageSwarmsDir = path.join(root, "package-swarms");
		const cwd = path.join(root, "workspace");

		writeAgent(packageAgentsDir, "review.md", {
			name: "review",
			description: "Package agent",
		});
		writeSwarm(packageSwarmsDir, "review", {
			name: "review",
			description: "Package review panel",
			members: [],
		});

		expect(() =>
			discoverAgents(cwd, {
				packageAgentsDir,
				userAgentsDir: path.join(root, "user-agents"),
				projectAgentsDir: null,
				packageSwarmsDir,
				projectSwarmsDir: null,
				settingsPath: null,
			}),
		).toThrowError(/defined as both an agent and a swarm/i);
	});

	it("throws when a swarm member is unknown", () => {
		const root = makeTempDir("subagent-unknown-member-");
		const packageAgentsDir = path.join(root, "package-agents");
		const packageSwarmsDir = path.join(root, "package-swarms");
		const cwd = path.join(root, "workspace");

		writeAgent(packageAgentsDir, "alpha.md", {
			name: "alpha",
			description: "Package agent",
		});
		writeSwarm(packageSwarmsDir, "review", {
			name: "review",
			description: "Package review panel",
			members: ["alpha", "missing-agent"],
		});

		expect(() =>
			discoverAgents(cwd, {
				packageAgentsDir,
				userAgentsDir: path.join(root, "user-agents"),
				projectAgentsDir: null,
				packageSwarmsDir,
				projectSwarmsDir: null,
				settingsPath: null,
			}),
		).toThrowError(/unknown member/i);
	});

	it("throws when a swarm includes nested swarm members", () => {
		const root = makeTempDir("subagent-nested-member-");
		const packageAgentsDir = path.join(root, "package-agents");
		const packageSwarmsDir = path.join(root, "package-swarms");
		const cwd = path.join(root, "workspace");

		writeAgent(packageAgentsDir, "alpha.md", {
			name: "alpha",
			description: "Package agent",
		});
		writeSwarm(packageSwarmsDir, "review", {
			name: "review",
			description: "Package review panel",
			members: ["panel"],
		});
		writeSwarm(packageSwarmsDir, "panel", {
			name: "panel",
			description: "Nested panel",
			members: ["alpha"],
		});

		expect(() =>
			discoverAgents(cwd, {
				packageAgentsDir,
				userAgentsDir: path.join(root, "user-agents"),
				projectAgentsDir: null,
				packageSwarmsDir,
				projectSwarmsDir: null,
				settingsPath: null,
			}),
		).toThrowError(/nested swarm member/i);
	});

	it("throws when a swarm contains duplicate members", () => {
		const root = makeTempDir("subagent-duplicate-member-");
		const packageAgentsDir = path.join(root, "package-agents");
		const packageSwarmsDir = path.join(root, "package-swarms");
		const cwd = path.join(root, "workspace");

		writeAgent(packageAgentsDir, "alpha.md", {
			name: "alpha",
			description: "Package agent",
		});
		writeSwarm(packageSwarmsDir, "review", {
			name: "review",
			description: "Package review panel",
			members: ["alpha", "alpha"],
		});

		expect(() =>
			discoverAgents(cwd, {
				packageAgentsDir,
				userAgentsDir: path.join(root, "user-agents"),
				projectAgentsDir: null,
				packageSwarmsDir,
				projectSwarmsDir: null,
				settingsPath: null,
			}),
		).toThrowError(/duplicate member/i);
	});

	it("loads bundled repo agents from pi/agents by default", () => {
		const root = makeTempDir("subagent-bundled-");
		const userAgentsDir = path.join(root, "user-agents");
		const cwd = path.join(root, "workspace");

		const discovery = discoverAgents(cwd, {
			userAgentsDir,
			projectAgentsDir: null,
			settingsPath: null,
		});

		const bundledAgents = discovery.agents.filter((agent) => agent.source === "package");
		expect(bundledAgents.map((agent) => agent.name).sort()).toEqual([
			"council-evidence-scout",
			"council-scope-guard",
			"council-simplifier",
			"council-skeptic",
			"deep-review-code-smells",
			"deep-review-project-rules",
			"deep-review-spec-alignment",
			"deep-review-test-quality",
			"fixer",
			"hack",
			"review",
			"scout",
		]);
		for (const agent of bundledAgents) {
			expect(agent.filePath).toContain(`${path.sep}pi/agents${path.sep}`);
		}
		expect(
			bundledAgents
				.filter(
					(agent) => agent.name.startsWith("deep-review-") || agent.name.startsWith("council-"),
				)
				.every((agent) => agent.hidden),
		).toBe(true);
		expect(
			bundledAgents
				.filter(
					(agent) => !agent.name.startsWith("deep-review-") && !agent.name.startsWith("council-"),
				)
				.every((agent) => !agent.hidden),
		).toBe(true);

		expect(discovery.swarms.filter((swarm) => swarm.source === "package")).toEqual(
			expect.arrayContaining([
				{
					name: "deep-review",
					description:
						"Multi-role code review for a full feature, PR, or session workload. Use `review` for faster/cheaper spot checks. Provide scope anchors: commits/diff, PRD/spec/task files, relevant paths, intent, risks, and validation results. Upfront exploration notes save work because every reviewer receives the same hot context instead of rediscovering it.",
					hidden: false,
					members: [
						"deep-review-code-smells",
						"deep-review-project-rules",
						"deep-review-test-quality",
						"deep-review-spec-alignment",
					],
					source: "package",
					filePath: expect.stringContaining(
						`${path.sep}pi/agents${path.sep}deep-review${path.sep}swarm.json`,
					),
				},
				{
					name: "council",
					description:
						"Multi-role ideation panel for when the main agent has a concrete answer, plan, design, or recommendation and wants another opinion before reporting back to the user. Council runs four members: skeptic challenges assumptions, evidence scout checks what the codebase proves, simplifier proposes lower-cost alternatives, scope guard asks whether this is the right problem and scope. Provide as much useful context as possible: proposed direction, intended outcome, problem being solved, tradeoff/decision to validate, relevant files/specs/code paths, constraints, risks, rejected options, and what kind of help would be useful. Rich context grounds advice in the real choice. Use for non-trivial decisions with genuine uncertainty; skip for factual lookups, trivial confirmations, or questions the user should answer directly.",
					hidden: false,
					members: [
						"council-skeptic",
						"council-evidence-scout",
						"council-simplifier",
						"council-scope-guard",
					],
					source: "package",
					filePath: expect.stringContaining(
						`${path.sep}pi/agents${path.sep}council${path.sep}swarm.json`,
					),
				},
			]),
		);
	});
});

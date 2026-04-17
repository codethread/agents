import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	discoverAgents,
	findAgentByName,
	formatAgentsForPrompt,
	formatSelectedAgentPrompt,
	getAgentRuntimeSettings,
	getAgentActiveTools,
	getInheritedAgentRuntimeSettings,
	parseAgentFlagCliOverrides,
	type AgentConfig,
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

function writeAgent(
	dir: string,
	fileName: string,
	params: {
		name: string;
		description: string;
		meta?: string;
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

describe("formatAgentsForPrompt", () => {
	it("returns an empty string when no subagents are available", () => {
		expect(formatAgentsForPrompt([])).toBe("");
	});

	it("formats subagents as an XML list with escaped names and descriptions", () => {
		const agents: AgentConfig[] = [
			{
				name: "alpha",
				description: "General-purpose helper",
				tools: [],
				systemPrompt: "prompt",
				source: "package",
				filePath: "/tmp/alpha.md",
			},
			{
				name: "beta <fast>",
				description: "Map dirs & files > summarize",
				tools: [],
				systemPrompt: "prompt",
				source: "user",
				filePath: "/tmp/beta.md",
			},
		];

		expect(formatAgentsForPrompt(agents)).toBe(
			[
				"",
				"",
				"These are the available subagents with their intended use.",
				"",
				"<available_subagents>",
				"  <subagent>",
				"    <name>alpha</name>",
				"    <description>General-purpose helper</description>",
				"  </subagent>",
				"  <subagent>",
				"    <name>beta &lt;fast&gt;</name>",
				"    <description>Map dirs &amp; files &gt; summarize</description>",
				"  </subagent>",
				"</available_subagents>",
			].join("\n"),
		);
	});
});

describe("getAgentRuntimeSettings", () => {
	it("parses model ref and thinking level from the agent model field", () => {
		const agent: AgentConfig = {
			name: "builder",
			description: "Implementation agent",
			tools: ["read", "edit"],
			model: "openai-codex/gpt-5.4-mini:high",
			systemPrompt: "You are builder.",
			source: "package",
			filePath: "/tmp/builder.md",
		};

		expect(getAgentRuntimeSettings(agent)).toEqual({
			tools: ["read", "edit"],
			modelFlagValue: "openai-codex/gpt-5.4-mini:high",
			modelRef: "openai-codex/gpt-5.4-mini",
			thinkingLevel: "high",
			systemPrompt: "You are builder.",
		});
	});

	it("treats non-thinking suffixes as part of the model string", () => {
		const agent: AgentConfig = {
			name: "custom",
			description: "Custom model agent",
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
	it("treats the inherited tool list as the exact active set across built-in and extension tools", () => {
		expect(
			getAgentActiveTools(
				["read", "questionnaire"],
				[
					{ name: "read", sourceInfo: { source: "builtin" } },
					{ name: "bash", sourceInfo: { source: "builtin" } },
					{ name: "questionnaire", sourceInfo: { source: "/repo/questionnaire.ts" } },
					{ name: "subagent", sourceInfo: { source: "/repo/subagent.ts" } },
				],
			),
		).toEqual(["read", "questionnaire"]);
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
			thinkingLevel: "low",
		});
	});
});

describe("formatSelectedAgentPrompt", () => {
	it("returns the agent prompt with a separating blank line", () => {
		const agent: AgentConfig = {
			name: "scout",
			description: "Recon agent",
			tools: [],
			systemPrompt: "You are scout.\nStay concise.",
			source: "package",
			filePath: "/tmp/scout.md",
		};

		expect(formatSelectedAgentPrompt(agent)).toBe("\n\nYou are scout.\nStay concise.");
	});

	it("returns an empty string for missing or blank prompts", () => {
		expect(formatSelectedAgentPrompt(undefined)).toBe("");
		expect(
			formatSelectedAgentPrompt({
				name: "blank",
				description: "Blank agent",
				tools: [],
				systemPrompt: " \n\t ",
				source: "user",
				filePath: "/tmp/blank.md",
			}),
		).toBe("");
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
			tools: "Glob, Questionnaire, Subagent",
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
			tools: ["read", "bash"],
			model: "openai/gpt-5.4",
		});
		expect(byName.get("gamma")).toMatchObject({
			source: "user",
			tools: ["find", "questionnaire", "subagent"],
		});
		expect(byName.get("shared")).toMatchObject({
			source: "project",
			filePath: projectAgentPath,
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
			settingsPath: null,
		});

		expect(discovery.agents).toHaveLength(1);
		expect(discovery.agents[0]).toMatchObject({
			name: "scout",
			description: "Recon agent",
			tools: ["read", "bash"],
			systemPrompt: "You are scout.",
		});
		expect(formatAgentsForPrompt(discovery.agents)).not.toContain("Author-only rationale");
		expect(formatAgentsForPrompt(discovery.agents)).not.toContain("meta");
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
			settingsPath: null,
		});

		expect(discovery.projectAgentsDir).toBeNull();
		expect(discovery.projectAgents).toEqual([]);
		expect(discovery.agents.map((agent) => agent.name).sort()).toEqual([
			"temp-package",
			"temp-user",
		]);
		for (const agent of discovery.agents) {
			expect(agent.tools).toEqual([]);
		}
	});

	it("loads bundled repo agents from pi-agents by default", () => {
		const root = makeTempDir("subagent-bundled-");
		const userAgentsDir = path.join(root, "user-agents");
		const cwd = path.join(root, "workspace");

		const discovery = discoverAgents(cwd, {
			userAgentsDir,
			projectAgentsDir: null,
			settingsPath: null,
		});

		const bundledAgents = discovery.agents.filter((agent) => agent.source === "package");
		expect(bundledAgents.map((agent) => agent.name).sort()).toEqual(["builder", "hack", "scout"]);
		for (const agent of bundledAgents) {
			expect(agent.filePath).toContain(`${path.sep}pi-agents${path.sep}`);
		}
	});
});

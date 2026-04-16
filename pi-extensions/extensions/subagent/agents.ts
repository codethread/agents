/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "package" | "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	userAgents: AgentConfig[];
	projectAgents: AgentConfig[];
	projectAgentsDir: string | null;
}

export interface AgentDiscoveryOptions {
	packageAgentsDir?: string | null;
	userAgentsDir?: string;
	projectAgentsDir?: string | null;
	settingsPath?: string | null;
}

export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentRuntimeSettings {
	tools?: string[];
	modelFlagValue?: string;
	modelRef?: string;
	thinkingLevel?: AgentThinkingLevel;
	systemPrompt: string;
}

export interface AgentFlagCliOverrides {
	hasModelOverride: boolean;
	hasThinkingOverride: boolean;
	hasToolsOverride: boolean;
}

interface ToolLike {
	name: string;
	sourceInfo: {
		source: string;
	};
}

const PI_BUILTIN_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

const CLAUDE_TOOL_MAP: Record<string, string | null> = {
	read: "read",
	bash: "bash",
	edit: "edit",
	write: "write",
	grep: "grep",
	glob: "find",
	ls: "ls",
	multiedit: "edit",
	notebookedit: "edit",
	task: null,
	websearch: null,
	webfetch: null,
	skill: null,
};

interface PiSettings {
	defaultProvider?: string;
	defaultModel?: string;
	enabledModels?: string[];
}

const THINKING_LEVELS = new Set<AgentThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

function normalizeTools(rawTools: string[] | undefined): string[] | undefined {
	if (!rawTools || rawTools.length === 0) return undefined;

	const mapped = rawTools
		.map((tool) => tool.trim())
		.filter(Boolean)
		.map((tool) => {
			const lower = tool.toLowerCase();
			if (PI_BUILTIN_TOOLS.has(lower)) return lower;
			return CLAUDE_TOOL_MAP[lower] ?? null;
		})
		.filter((tool): tool is string => tool !== null && PI_BUILTIN_TOOLS.has(tool));

	const unique = Array.from(new Set(mapped));
	return unique.length > 0 ? unique : undefined;
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		const raw = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function findNearestSettingsFile(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "settings.json");
		if (fs.existsSync(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	const userSettings = path.join(getAgentDir(), "settings.json");
	if (fs.existsSync(userSettings)) return userSettings;
	return null;
}

function pickPreferredModel(models: string[], preferMini: boolean): string | undefined {
	if (models.length === 0) return undefined;
	if (preferMini) return models.find((m) => m.toLowerCase().includes("mini")) ?? models[0];
	return models.find((m) => !m.toLowerCase().includes("mini")) ?? models[0];
}

function resolveModelAlias(
	model: string | undefined,
	settings: PiSettings | null,
): string | undefined {
	if (!model) return undefined;

	const trimmed = model.trim();
	if (!trimmed) return undefined;
	if (trimmed.includes("/")) return trimmed;

	const lower = trimmed.toLowerCase();
	const enabled = settings?.enabledModels?.filter((m): m is string => typeof m === "string") ?? [];
	const openAiEnabled = enabled.filter(
		(m) => m.startsWith("openai-codex/") || m.startsWith("openai/"),
	);

	if (openAiEnabled.length === 0) return trimmed;

	const defaultQualified =
		settings?.defaultProvider && settings?.defaultModel
			? `${settings.defaultProvider}/${settings.defaultModel}`
			: undefined;
	const defaultEnabled =
		defaultQualified && openAiEnabled.includes(defaultQualified) ? defaultQualified : undefined;

	const fallbackLarge = defaultEnabled ?? pickPreferredModel(openAiEnabled, false);
	const fallbackMini = pickPreferredModel(openAiEnabled, true) ?? fallbackLarge;

	if (lower.includes("haiku")) return fallbackMini;
	if (lower.includes("sonnet") || lower.includes("opus") || lower.startsWith("claude")) {
		return fallbackLarge;
	}

	return trimmed;
}

function loadAgentsFromDir(
	dir: string,
	source: "package" | "user" | "project",
	settings: PiSettings | null,
): AgentConfig[] {
	const agents: AgentConfig[] = [];
	if (!fs.existsSync(dir)) return agents;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
		if (!frontmatter.name || !frontmatter.description) continue;

		const parsedTools = frontmatter.tools
			?.split(",")
			.map((tool: string) => tool.trim())
			.filter(Boolean);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: normalizeTools(parsedTools),
			model: resolveModelAlias(frontmatter.model, settings),
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function findBundledAgentsDir(): string | null {
	const extensionDir = path.dirname(fileURLToPath(import.meta.url));
	const candidates = [
		path.resolve(extensionDir, "../../../pi-agents"),
		path.resolve(extensionDir, "../../agents"),
	];

	for (const candidate of candidates) {
		if (isDirectory(candidate)) return candidate;
	}

	return null;
}

export function discoverAgents(
	cwd: string,
	options: AgentDiscoveryOptions = {},
): AgentDiscoveryResult {
	const packageAgentsDir =
		options.packageAgentsDir === undefined ? findBundledAgentsDir() : options.packageAgentsDir;
	const userAgentsDir = options.userAgentsDir ?? path.join(getAgentDir(), "agents");
	const projectAgentsDir =
		options.projectAgentsDir === undefined
			? findNearestProjectAgentsDir(cwd)
			: options.projectAgentsDir;
	const settingsPath =
		options.settingsPath === undefined ? findNearestSettingsFile(cwd) : options.settingsPath;
	const settings = settingsPath ? readJsonFile<PiSettings>(settingsPath) : null;

	const packageAgents = packageAgentsDir
		? loadAgentsFromDir(packageAgentsDir, "package", settings)
		: [];
	const userAgents = loadAgentsFromDir(userAgentsDir, "user", settings);
	const projectAgents = projectAgentsDir
		? loadAgentsFromDir(projectAgentsDir, "project", settings)
		: [];

	const agentMap = new Map<string, AgentConfig>();
	for (const agent of packageAgents) agentMap.set(agent.name, agent);
	for (const agent of userAgents) agentMap.set(agent.name, agent);
	for (const agent of projectAgents) agentMap.set(agent.name, agent);

	return {
		agents: Array.from(agentMap.values()),
		userAgents,
		projectAgents,
		projectAgentsDir,
	};
}

export function formatAgentList(
	agents: AgentConfig[],
	maxItems: number,
): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
		remaining,
	};
}

export function findAgentByName(
	agents: AgentConfig[],
	name: string | undefined | null,
): AgentConfig | undefined {
	const requestedName = name?.trim();
	if (!requestedName) return undefined;
	return agents.find((agent) => agent.name === requestedName);
}

function parseAgentModel(model: string | undefined): {
	modelFlagValue?: string;
	modelRef?: string;
	thinkingLevel?: AgentThinkingLevel;
} {
	const modelFlagValue = model?.trim();
	if (!modelFlagValue) return {};

	const lastColon = modelFlagValue.lastIndexOf(":");
	if (lastColon === -1) {
		return { modelFlagValue, modelRef: modelFlagValue };
	}

	const modelRef = modelFlagValue.slice(0, lastColon).trim();
	const maybeThinkingLevel = modelFlagValue.slice(lastColon + 1).trim();
	if (!modelRef || !THINKING_LEVELS.has(maybeThinkingLevel as AgentThinkingLevel)) {
		return { modelFlagValue, modelRef: modelFlagValue };
	}

	return {
		modelFlagValue,
		modelRef,
		thinkingLevel: maybeThinkingLevel as AgentThinkingLevel,
	};
}

export function getAgentRuntimeSettings(agent: AgentConfig): AgentRuntimeSettings {
	const parsedModel = parseAgentModel(agent.model);
	return {
		tools: agent.tools,
		systemPrompt: agent.systemPrompt,
		...parsedModel,
	};
}

export function getInheritedAgentRuntimeSettings(
	agent: AgentConfig,
	cliOverrides: AgentFlagCliOverrides,
): AgentRuntimeSettings {
	const settings = getAgentRuntimeSettings(agent);
	return {
		systemPrompt: settings.systemPrompt,
		tools: cliOverrides.hasToolsOverride ? undefined : settings.tools,
		modelFlagValue: cliOverrides.hasModelOverride ? undefined : settings.modelFlagValue,
		modelRef: cliOverrides.hasModelOverride ? undefined : settings.modelRef,
		thinkingLevel: cliOverrides.hasThinkingOverride ? undefined : settings.thinkingLevel,
	};
}

function hasCliFlag(argv: string[], longFlag: string, shortFlag?: string): boolean {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === longFlag || (shortFlag && arg === shortFlag)) return true;
		if (arg.startsWith(`${longFlag}=`)) return true;
		if (shortFlag && arg.startsWith(`${shortFlag}=`)) return true;
	}
	return false;
}

export function parseAgentFlagCliOverrides(argv: string[]): AgentFlagCliOverrides {
	return {
		hasModelOverride: hasCliFlag(argv, "--model", "-m") || hasCliFlag(argv, "--provider"),
		hasThinkingOverride: hasCliFlag(argv, "--thinking"),
		hasToolsOverride: hasCliFlag(argv, "--tools") || hasCliFlag(argv, "--no-tools"),
	};
}

export function getAgentActiveTools(
	inheritedBuiltins: string[] | undefined,
	allTools: ToolLike[],
): string[] | undefined {
	if (!inheritedBuiltins?.length) return undefined;
	const nonBuiltins = allTools
		.filter((tool) => tool.sourceInfo.source !== "builtin")
		.map((tool) => tool.name);
	return Array.from(new Set([...inheritedBuiltins, ...nonBuiltins]));
}

export function formatSelectedAgentPrompt(agent: AgentConfig | undefined): string {
	const systemPrompt = agent ? getAgentRuntimeSettings(agent).systemPrompt : "";
	if (!systemPrompt.trim()) return "";
	return `\n\n${systemPrompt}`;
}

function escapeXml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatAgentsForPrompt(agents: AgentConfig[]): string {
	if (agents.length === 0) return "";

	const lines = [
		"",
		"",
		"These are the available subagents with their intended use.",
		"",
		"<available_subagents>",
	];

	for (const agent of agents) {
		lines.push("  <subagent>");
		lines.push(`    <name>${escapeXml(agent.name)}</name>`);
		lines.push(`    <description>${escapeXml(agent.description)}</description>`);
		lines.push("  </subagent>");
	}

	lines.push("</available_subagents>");
	return lines.join("\n");
}

/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { wrapSystemReminder } from "../../shared/xml.js";

export interface AgentConfig {
	name: string;
	description: string;
	hidden: boolean;
	tools: string[];
	model?: string;
	modelCandidates?: AgentModelCandidate[];
	modelPolicyError?: string;
	systemPrompt: string;
	source: "package" | "user" | "project";
	filePath: string;
}

export interface SwarmConfig {
	name: string;
	description: string;
	hidden: boolean;
	members: string[];
	source: "package" | "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	userAgents: AgentConfig[];
	projectAgents: AgentConfig[];
	projectAgentsDir: string | null;
	swarms: SwarmConfig[];
	userSwarms: SwarmConfig[];
	projectSwarms: SwarmConfig[];
	projectSwarmsDir: string | null;
}

export type DelegationTarget =
	| { kind: "agent"; agent: AgentConfig }
	| { kind: "swarm"; swarm: SwarmConfig };

export interface AgentDiscoveryOptions {
	packageAgentsDir?: string | null;
	userAgentsDir?: string;
	projectAgentsDir?: string | null;
	packageSwarmsDir?: string | null;
	userSwarmsDir?: string;
	projectSwarmsDir?: string | null;
	settingsPath?: string | null;
	env?: NodeJS.ProcessEnv;
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

export interface ModelRegistryLike {
	find(provider: string, model: string): unknown;
	getAll?(): unknown[];
	hasConfiguredAuth?(model: unknown): boolean;
}

interface ToolLike {
	name: string;
	sourceInfo: {
		source: string;
	};
}

const PI_CANONICAL_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

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

export interface AgentModelCandidate {
	id: string;
}

const THINKING_LEVELS = new Set<AgentThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

function normalizeTools(rawTools: string[] | undefined): string[] {
	if (!rawTools || rawTools.length === 0) return [];

	const mapped = rawTools
		.map((tool) => tool.trim())
		.filter(Boolean)
		.map((tool) => {
			const lower = tool.toLowerCase();
			if (PI_CANONICAL_TOOLS.has(lower)) return lower;
			if (Object.hasOwn(CLAUDE_TOOL_MAP, lower)) return CLAUDE_TOOL_MAP[lower];
			return lower;
		})
		.filter((tool): tool is string => tool !== null);

	return Array.from(new Set(mapped));
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

function isTruthyEnvValue(value: string | undefined): boolean {
	if (value === undefined || value === "") return false;
	return !new Set(["false", "0", "no", "off"]).has(value.toLowerCase());
}

function evaluateWhenExpression(expression: string, env: NodeJS.ProcessEnv = process.env): boolean {
	const trimmed = expression.trim();
	if (!trimmed) throw new Error("empty when expression");

	const truthyMatch = trimmed.match(/^(!?)\$([A-Za-z_][A-Za-z0-9_]*)$/);
	if (truthyMatch) {
		const [, negation, name] = truthyMatch;
		const present = isTruthyEnvValue(env[name]);
		return negation ? !present : present;
	}

	const comparisonMatch = trimmed.match(
		/^\$([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*(?:"([^"]*)"|'([^']*)')$/,
	);
	if (comparisonMatch) {
		const [, name, operator, doubleQuoted, singleQuoted] = comparisonMatch;
		const expected = doubleQuoted ?? singleQuoted ?? "";
		const actual = env[name];
		const equal = actual === expected;
		return operator === "==" ? equal : !equal;
	}

	throw new Error(`unsupported when expression "${expression}"`);
}

function parseModelPolicy(
	value: unknown,
	agentName: string,
	filePath: string,
	env: NodeJS.ProcessEnv = process.env,
): { model?: string; modelCandidates?: AgentModelCandidate[]; modelPolicyError?: string } {
	if (value === undefined) return {};

	try {
		const entries = Array.isArray(value) ? value : [value];
		if (entries.length === 0) throw new Error("model list must not be empty");

		const candidates: AgentModelCandidate[] = [];
		const seen = new Set<string>();
		for (const entry of entries) {
			const candidate = parseModelCandidate(entry, env);
			if (!candidate) continue;
			if (seen.has(candidate.id)) continue;
			seen.add(candidate.id);
			candidates.push(candidate);
		}

		if (candidates.length === 0) throw new Error("model policy leaves no candidates after gating");

		return { model: candidates[0]?.id, modelCandidates: candidates };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			modelPolicyError: `Invalid model policy for agent "${agentName}" at ${filePath}: ${reason}`,
		};
	}
}

function parseModelCandidate(entry: unknown, env: NodeJS.ProcessEnv): AgentModelCandidate | null {
	if (typeof entry === "string") {
		const id = entry.trim();
		if (!id) throw new Error("model id must be a non-empty string");
		return { id };
	}

	if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
		throw new Error("model entries must be strings or objects");
	}

	const raw = entry as Record<string, unknown>;
	const unknownKeys = Object.keys(raw).filter((key) => key !== "id" && key !== "when");
	if (unknownKeys.length > 0) {
		throw new Error(`model object has unknown key(s): ${unknownKeys.join(", ")}`);
	}

	if (typeof raw.id !== "string" || !raw.id.trim()) {
		throw new Error("model object id must be a non-empty string");
	}
	if (raw.when !== undefined && typeof raw.when !== "string") {
		throw new Error("model object when must be a string");
	}
	if (raw.when !== undefined && !evaluateWhenExpression(raw.when, env)) return null;
	return { id: raw.id.trim() };
}

function getFrontmatterString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function parseHiddenFrontmatter(value: unknown): boolean {
	if (value === true) return true;
	if (typeof value === "string") return value.trim().toLowerCase() === "true";
	return false;
}

function parseSwarmMembers(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;

	const members: string[] = [];
	for (const member of value) {
		if (typeof member !== "string") return null;
		const trimmed = member.trim();
		if (trimmed) members.push(trimmed);
	}

	return members;
}

function loadAgentsFromDir(
	dir: string,
	source: "package" | "user" | "project",
	env: NodeJS.ProcessEnv,
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

		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
		const name = getFrontmatterString(frontmatter.name);
		const description = getFrontmatterString(frontmatter.description);
		if (!name || !description) continue;

		const parsedTools = getFrontmatterString(frontmatter.tools)
			?.split(",")
			.map((tool: string) => tool.trim())
			.filter(Boolean);

		const parsedModel = parseModelPolicy(frontmatter.model, name, filePath, env);

		agents.push({
			name,
			description,
			hidden: parseHiddenFrontmatter(frontmatter.hidden),
			tools: normalizeTools(parsedTools),
			...parsedModel,
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

function loadAgentsFromSwarmsDir(
	dir: string,
	source: "package" | "user" | "project",
	env: NodeJS.ProcessEnv,
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
		if (!entry.isDirectory()) continue;
		agents.push(...loadAgentsFromDir(path.join(dir, entry.name), source, env));
	}

	return agents;
}

interface SwarmJsonFile {
	name?: unknown;
	description?: unknown;
	hidden?: unknown;
	members?: unknown;
}

function loadSwarmsFromDir(dir: string, source: "package" | "user" | "project"): SwarmConfig[] {
	const swarms: SwarmConfig[] = [];
	if (!fs.existsSync(dir)) return swarms;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return swarms;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const filePath = path.join(dir, entry.name, "swarm.json");
		const raw = readJsonFile<SwarmJsonFile>(filePath);
		if (!raw) continue;

		const name = getFrontmatterString(raw.name);
		const description = getFrontmatterString(raw.description);
		const members = parseSwarmMembers(raw.members);
		if (!name || !description || !members) continue;

		swarms.push({
			name,
			description,
			hidden: parseHiddenFrontmatter(raw.hidden),
			members,
			source,
			filePath,
		});
	}

	return swarms;
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

function findNearestProjectSwarmsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "swarms");
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

function findBundledSwarmsDir(): string | null {
	return findBundledAgentsDir();
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
	const packageSwarmsDir =
		options.packageSwarmsDir === undefined ? findBundledSwarmsDir() : options.packageSwarmsDir;
	const userSwarmsDir = options.userSwarmsDir ?? path.join(getAgentDir(), "swarms");
	const projectSwarmsDir =
		options.projectSwarmsDir === undefined
			? findNearestProjectSwarmsDir(cwd)
			: options.projectSwarmsDir;
	const env = options.env ?? process.env;

	const packageAgents = [
		...(packageAgentsDir ? loadAgentsFromDir(packageAgentsDir, "package", env) : []),
		...(packageSwarmsDir ? loadAgentsFromSwarmsDir(packageSwarmsDir, "package", env) : []),
	];
	const packageSwarms = packageSwarmsDir ? loadSwarmsFromDir(packageSwarmsDir, "package") : [];

	const userAgents = [
		...loadAgentsFromDir(userAgentsDir, "user", env),
		...(userSwarmsDir ? loadAgentsFromSwarmsDir(userSwarmsDir, "user", env) : []),
	];
	const userSwarms = userSwarmsDir ? loadSwarmsFromDir(userSwarmsDir, "user") : [];

	const projectAgents = [
		...(projectAgentsDir ? loadAgentsFromDir(projectAgentsDir, "project", env) : []),
		...(projectSwarmsDir ? loadAgentsFromSwarmsDir(projectSwarmsDir, "project", env) : []),
	];
	const projectSwarms = projectSwarmsDir ? loadSwarmsFromDir(projectSwarmsDir, "project") : [];

	const agentMap = new Map<string, AgentConfig>();
	for (const agent of packageAgents) agentMap.set(agent.name, agent);
	for (const agent of userAgents) agentMap.set(agent.name, agent);
	for (const agent of projectAgents) agentMap.set(agent.name, agent);

	const swarmMap = new Map<string, SwarmConfig>();
	for (const swarm of packageSwarms) swarmMap.set(swarm.name, swarm);
	for (const swarm of userSwarms) swarmMap.set(swarm.name, swarm);
	for (const swarm of projectSwarms) swarmMap.set(swarm.name, swarm);

	const discovery: AgentDiscoveryResult = {
		agents: Array.from(agentMap.values()),
		userAgents,
		projectAgents,
		projectAgentsDir,
		swarms: Array.from(swarmMap.values()),
		userSwarms,
		projectSwarms,
		projectSwarmsDir,
	};
	validateDelegationTargets(discovery);
	return discovery;
}

function validateDelegationTargets(discovery: AgentDiscoveryResult): void {
	const agentNames = new Set(discovery.agents.map((agent) => agent.name));
	for (const swarm of discovery.swarms) {
		if (agentNames.has(swarm.name)) {
			throw new Error(
				`Invalid delegation catalog: "${swarm.name}" is defined as both an agent and a swarm. Agent and swarm names must be unique.`,
			);
		}
	}

	for (const swarm of discovery.swarms) {
		const seenMembers = new Set<string>();
		for (const rawMember of swarm.members) {
			const member = rawMember.trim();
			if (seenMembers.has(member)) {
				throw new Error(
					`Invalid delegation catalog: swarm "${swarm.name}" contains duplicate member "${member}".`,
				);
			}
			seenMembers.add(member);

			const target = findDelegationTarget(discovery, member);
			if (!target) {
				throw new Error(
					`Invalid delegation catalog: swarm "${swarm.name}" has unknown member "${member}".`,
				);
			}
			if (target.kind === "swarm") {
				throw new Error(
					`Invalid delegation catalog: swarm "${swarm.name}" has nested swarm member "${member}". Swarm members must be agents.`,
				);
			}
		}
	}
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

export function findDelegationTarget(
	discovery: AgentDiscoveryResult,
	name: string | undefined | null,
): DelegationTarget | undefined {
	const requestedName = name?.trim();
	if (!requestedName) return undefined;
	const agent = discovery.agents.find((candidate) => candidate.name === requestedName);
	if (agent) return { kind: "agent", agent };

	const swarm = discovery.swarms.find((candidate) => candidate.name === requestedName);
	if (swarm) return { kind: "swarm", swarm };
	return undefined;
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

function getModelId(model: unknown): string | undefined {
	return typeof model === "object" && model !== null && "id" in model
		? String((model as { id: unknown }).id)
		: undefined;
}

export function resolveAgentModelCandidate(
	candidateId: string,
	modelRegistry: ModelRegistryLike,
): { model: unknown; modelRef: string } {
	const { modelRef } = parseAgentModel(candidateId);
	if (!modelRef) throw new Error(`model candidate "${candidateId}" is empty`);

	const [provider, ...idParts] = modelRef.split("/");
	const id = idParts.join("/");
	if (provider && id) {
		const model = modelRegistry.find(provider, id);
		if (!model) throw new Error(`candidate "${modelRef}" is not available in this Pi runtime`);
		return { model, modelRef };
	}

	const bareMatches =
		modelRegistry.getAll?.().filter((model) => getModelId(model) === modelRef) ?? [];
	if (bareMatches.length === 1) return { model: bareMatches[0]!, modelRef };
	if (bareMatches.length > 1) {
		throw new Error(`candidate "${modelRef}" is ambiguous across providers`);
	}
	throw new Error(`candidate "${modelRef}" is not available in this Pi runtime`);
}

export function validateAgentModelPolicy(
	agent: AgentConfig,
	modelRegistry: ModelRegistryLike,
): string[] {
	if (agent.modelPolicyError) return [agent.modelPolicyError];
	if (!agent.modelCandidates) return [];

	const invalidReasons: string[] = [];
	let validCandidateCount = 0;
	for (const candidate of agent.modelCandidates) {
		try {
			const { model, modelRef } = resolveAgentModelCandidate(candidate.id, modelRegistry);
			if (modelRegistry.hasConfiguredAuth && !modelRegistry.hasConfiguredAuth(model)) {
				invalidReasons.push(`candidate "${modelRef}" has no configured API key/auth`);
			} else {
				validCandidateCount++;
			}
		} catch (error) {
			invalidReasons.push(error instanceof Error ? error.message : String(error));
		}
	}

	if (validCandidateCount > 0) return [];
	return [
		`Invalid model policy for agent "${agent.name}" at ${agent.filePath}: no valid model candidates (${invalidReasons.join("; ")})`,
	];
}

export function validateAgentModelPolicies(
	agents: AgentConfig[],
	modelRegistry: ModelRegistryLike,
): string[] {
	return agents.flatMap((agent) => validateAgentModelPolicy(agent, modelRegistry));
}

export function getValidAgentModelCandidates(
	agent: AgentConfig,
	modelRegistry: ModelRegistryLike,
): AgentModelCandidate[] | undefined {
	if (!agent.modelCandidates) return undefined;
	const validCandidates: AgentModelCandidate[] = [];
	for (const candidate of agent.modelCandidates) {
		try {
			const { model } = resolveAgentModelCandidate(candidate.id, modelRegistry);
			if (!modelRegistry.hasConfiguredAuth || modelRegistry.hasConfiguredAuth(model)) {
				validCandidates.push(candidate);
			}
		} catch {
			// Startup/runtime validation reports traceable policy errors; selection only needs valid candidates.
		}
	}
	return validCandidates;
}

export function getFirstValidAgentModelCandidate(
	agent: AgentConfig,
	modelRegistry: ModelRegistryLike,
): AgentModelCandidate | undefined {
	return getValidAgentModelCandidates(agent, modelRegistry)?.[0];
}

export function getInheritedAgentRuntimeSettings(
	agent: AgentConfig,
	cliOverrides: AgentFlagCliOverrides,
	modelRegistry?: ModelRegistryLike,
): AgentRuntimeSettings {
	const selectedCandidate =
		!cliOverrides.hasModelOverride && modelRegistry
			? getFirstValidAgentModelCandidate(agent, modelRegistry)
			: undefined;
	const settings = getAgentRuntimeSettings(
		selectedCandidate ? { ...agent, model: selectedCandidate.id } : agent,
	);
	return {
		systemPrompt: settings.systemPrompt,
		tools: cliOverrides.hasToolsOverride ? undefined : settings.tools,
		modelFlagValue: cliOverrides.hasModelOverride ? undefined : settings.modelFlagValue,
		modelRef: cliOverrides.hasModelOverride ? undefined : settings.modelRef,
		thinkingLevel:
			cliOverrides.hasModelOverride || cliOverrides.hasThinkingOverride
				? undefined
				: settings.thinkingLevel,
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
	inheritedTools: string[] | undefined,
	allTools: ToolLike[],
): string[] | undefined {
	if (inheritedTools === undefined) return undefined;
	const availableToolNames = new Set(allTools.map((tool) => tool.name));
	return Array.from(new Set(inheritedTools.filter((tool) => availableToolNames.has(tool))));
}

export function formatSelectedAgentPrompt(agent: AgentConfig | undefined): string {
	const systemPrompt = agent ? getAgentRuntimeSettings(agent).systemPrompt : "";
	if (!systemPrompt.trim()) return "";
	return `\n\n${wrapSystemReminder("selected-agent-prompt", systemPrompt)}`;
}

function escapeXml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatAgentsForPrompt(agents: AgentConfig[], swarms: SwarmConfig[] = []): string {
	const visibleTargets = [...agents, ...swarms].filter((target) => !target.hidden);
	if (visibleTargets.length === 0) return "";

	const lines = [
		"These are the available subagents with their intended use.",
		"",
		"<available-subagents>",
	];

	for (const target of visibleTargets) {
		lines.push("  <subagent>");
		lines.push(`    <name>${escapeXml(target.name)}</name>`);
		lines.push(`    <description>${escapeXml(target.description)}</description>`);
		lines.push("  </subagent>");
	}

	lines.push("</available-subagents>");
	return `\n\n${wrapSystemReminder("available-subagents", lines.join("\n"))}`;
}

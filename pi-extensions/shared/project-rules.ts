import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { escapeXmlAttribute, wrapSystemReminder } from "./xml.js";

export type ProjectRuleSource = "claude" | "agents";

export interface ExecLike {
	(
		command: string,
		args: string[],
		options?: { signal?: AbortSignal; timeout?: number },
	): Promise<{
		stdout: string;
		code: number;
	}>;
}

export interface ProjectRule {
	source: ProjectRuleSource;
	path: string;
	relativeRulePath: string;
	content: string;
	body: string;
	paths?: string[];
	mtimeMs: number;
}

export interface ProjectRulesDiscovery {
	projectRoot: string;
	rules: ProjectRule[];
	warnings: string[];
}

const GIT_TIMEOUT_MS = 5_000;
const RULE_DIRS: Array<{ source: ProjectRuleSource; dir: string }> = [
	{ source: "claude", dir: path.join(".claude", "rules") },
	{ source: "agents", dir: path.join(".agents", "rules") },
];

export async function resolveProjectRoot(
	cwd: string,
	exec: ExecLike,
	signal?: AbortSignal,
): Promise<string> {
	const result = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
		signal,
		timeout: GIT_TIMEOUT_MS,
	});
	if (!result || result.code !== 0) return cwd;
	return result.stdout.trim() || cwd;
}

function toPosix(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

function walkMarkdownFiles(dir: string): string[] {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	return entries.flatMap((entry) => {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) return walkMarkdownFiles(entryPath);
		if (entry.isFile() && entry.name.endsWith(".md")) return [entryPath];
		return [];
	});
}

function parsePathsYaml(yaml: string): string[] | undefined {
	const lines = yaml.split(/\r?\n/);
	const pathsIndex = lines.findIndex((line) => /^paths\s*:/.test(line.trim()));
	if (pathsIndex === -1) return undefined;

	const first = lines[pathsIndex].trim();
	const inline = first.match(/^paths\s*:\s*\[(.*)]\s*$/);
	if (inline) {
		const values = inline[1]
			.split(",")
			.map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
			.filter(Boolean);
		if (values.length === 0) throw new Error("paths must contain at least one pattern");
		return values;
	}

	if (first !== "paths:") throw new Error("paths must be a string array");
	const values: string[] = [];
	for (const line of lines.slice(pathsIndex + 1)) {
		if (!line.trim()) continue;
		if (!/^\s+-\s+/.test(line)) break;
		const value = line
			.replace(/^\s+-\s+/, "")
			.trim()
			.replace(/^['"]|['"]$/g, "");
		if (!value) throw new Error("paths entries must be non-empty strings");
		values.push(value);
	}
	if (values.length === 0) throw new Error("paths must contain at least one pattern");
	return values;
}

function parseRuleFile(content: string): { body: string; paths?: string[] } {
	if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
		return { body: content };
	}
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) throw new Error("unterminated frontmatter");
	return {
		body: content.slice(match[0].length),
		paths: parsePathsYaml(match[1]),
	};
}

export async function discoverProjectRules(
	cwd: string,
	exec: ExecLike,
	signal?: AbortSignal,
): Promise<ProjectRulesDiscovery> {
	const projectRoot = await resolveProjectRoot(cwd, exec, signal);
	const byRelativePath = new Map<string, { source: ProjectRuleSource; filePath: string }>();

	for (const { source, dir } of RULE_DIRS) {
		const rulesRoot = path.join(projectRoot, dir);
		for (const filePath of walkMarkdownFiles(rulesRoot)) {
			const relativeRulePath = toPosix(path.relative(rulesRoot, filePath));
			byRelativePath.set(relativeRulePath, { source, filePath });
		}
	}

	const rules: ProjectRule[] = [];
	const warnings: string[] = [];
	for (const [relativeRulePath, entry] of [...byRelativePath.entries()].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		try {
			const content = readFileSync(entry.filePath, "utf8");
			const parsed = parseRuleFile(content);
			rules.push({
				source: entry.source,
				path: entry.filePath,
				relativeRulePath,
				content,
				body: parsed.body,
				paths: parsed.paths,
				mtimeMs: statSync(entry.filePath).mtimeMs,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`${entry.filePath}: ${message}`);
		}
	}

	return { projectRoot, rules, warnings };
}

export function getUnconditionalRules(rules: ProjectRule[]): ProjectRule[] {
	return rules.filter((rule) => rule.paths === undefined);
}

export function getPathScopedRules(rules: ProjectRule[]): ProjectRule[] {
	return rules.filter((rule) => rule.paths !== undefined);
}

function escapeRegex(text: string): string {
	return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function expandBraces(pattern: string): string[] {
	const match = pattern.match(/^(.*)\{([^{}]+)}(.*)$/);
	if (!match) return [pattern];
	return match[2].split(",").flatMap((part) => expandBraces(`${match[1]}${part}${match[3]}`));
}

function globToRegex(pattern: string): RegExp {
	let regex = "^";
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		const next = pattern[i + 1];
		if (char === "*" && next === "*") {
			if (pattern[i + 2] === "/") {
				regex += "(?:.*/)?";
				i += 2;
			} else {
				regex += ".*";
				i += 1;
			}
		} else if (char === "*") {
			regex += "[^/]*";
		} else if (char === "?") {
			regex += "[^/]";
		} else {
			regex += escapeRegex(char);
		}
	}
	return new RegExp(`${regex}$`);
}

export function normalizeProjectPath(
	filePath: string,
	cwd: string,
	projectRoot: string,
): string | null {
	const absolutePath = path.resolve(cwd, filePath);
	const relative = path.relative(projectRoot, absolutePath);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
	return toPosix(relative);
}

export function matchesRule(rule: ProjectRule, projectRelativePath: string): boolean {
	return (rule.paths ?? []).some((pattern) =>
		expandBraces(pattern).some((expanded) =>
			globToRegex(toPosix(expanded)).test(projectRelativePath),
		),
	);
}

export function matchingRules(rules: ProjectRule[], projectRelativePaths: string[]): ProjectRule[] {
	const seen = new Set<string>();
	const matched: ProjectRule[] = [];
	for (const rule of getPathScopedRules(rules)) {
		if (!projectRelativePaths.some((filePath) => matchesRule(rule, filePath))) continue;
		if (seen.has(rule.path)) continue;
		seen.add(rule.path);
		matched.push(rule);
	}
	return matched;
}

export function renderProjectRulesReminder(
	rules: ProjectRule[],
	options?: { triggeredBy?: string[]; intro?: string },
): string | null {
	if (rules.length === 0) return null;
	const parts: string[] = [];
	if (options?.intro) parts.push(options.intro);
	if (options?.triggeredBy?.length) {
		parts.push("Triggered by files:", ...options.triggeredBy.map((filePath) => `- ${filePath}`));
	}
	parts.push(
		...rules.map((rule) =>
			[
				`<rule-file path="${escapeXmlAttribute(rule.path)}">`,
				rule.body.trim(),
				"</rule-file>",
			].join("\n"),
		),
	);
	return wrapSystemReminder("project-rules", parts.filter(Boolean).join("\n\n"));
}

export function ruleSignature(rule: ProjectRule): string {
	return `${rule.path}:${rule.mtimeMs}`;
}

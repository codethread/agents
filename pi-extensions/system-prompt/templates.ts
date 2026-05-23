import { promises as fs } from "node:fs";
import path from "node:path";
import nunjucks from "nunjucks";
import { wrapSystemReminder } from "../shared/xml.js";

export type TemplateVars = Record<string, unknown>;

export type TemplateContext = {
	cwd: string;
	hasUI: boolean;
	tools?: string[];
	model?: {
		provider?: string;
		id?: string;
	} | null;
};

type TemplateMatch = {
	filePath: string;
	scope: "global" | "project";
};

export type TemplateSection = TemplateMatch & {
	reminderType: "rules" | "project-rules";
	renderedPrompt: string;
};

export const PROJECT_TEMPLATE_FILE = ".pi/agent.njk";
export const GLOBAL_TEMPLATE_FILE = "agent.njk";

function isTemplateVarsObject(value: unknown): value is TemplateVars {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolName(value: string): string {
	return value.trim().toLowerCase();
}

function parseRequiredTools(value: unknown): string[] | null {
	if (typeof value === "string") {
		const tool = normalizeToolName(value);
		return tool ? [tool] : null;
	}

	if (!Array.isArray(value) || value.length === 0) return null;

	const tools: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") return null;
		const tool = normalizeToolName(entry);
		if (!tool) return null;
		tools.push(tool);
	}
	return tools;
}

function getActiveToolSet(value: unknown): Set<string> {
	if (!Array.isArray(value)) return new Set();
	return new Set(
		value
			.filter((tool): tool is string => typeof tool === "string")
			.map((tool) => normalizeToolName(tool))
			.filter(Boolean),
	);
}

function hasAllTools(activeToolsValue: unknown, requiredToolsValue: unknown): boolean {
	const requiredTools = parseRequiredTools(requiredToolsValue);
	if (!requiredTools) return false;

	const activeTools = getActiveToolSet(activeToolsValue);
	return requiredTools.every((tool) => activeTools.has(tool));
}

export function expandHomePrefix(input: string): string {
	if (input === "~") return process.env.HOME ?? "~";
	if (input.startsWith("~/")) {
		const home = process.env.HOME;
		if (!home) return input;
		return path.join(home, input.slice(2));
	}
	return input;
}

function createNunjucksEnv(vars: TemplateVars): nunjucks.Environment {
	const env = new nunjucks.Environment();

	env.addFilter("regex_test", (value: unknown, pattern: string) => {
		if (typeof value !== "string") return false;
		return new RegExp(expandHomePrefix(pattern)).test(value);
	});

	env.addFilter("has_tools", (value: unknown, requiredTools: unknown) => {
		return hasAllTools(value, requiredTools);
	});

	env.addGlobal("has_tools", (requiredTools: unknown) => {
		return hasAllTools(vars.tools, requiredTools);
	});

	return env;
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export function getPiCodingAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.HOME ?? "~", ".pi", "agent");
}

export function getGlobalTemplatePath(): string {
	return path.join(getPiCodingAgentDir(), GLOBAL_TEMPLATE_FILE);
}

export async function findProjectTemplate(startCwd: string): Promise<TemplateMatch | null> {
	let currentDir = path.resolve(startCwd);

	while (true) {
		const filePath = path.join(currentDir, PROJECT_TEMPLATE_FILE);
		if (await pathExists(filePath)) {
			return { filePath, scope: "project" };
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export async function findGlobalTemplate(): Promise<TemplateMatch | null> {
	const filePath = getGlobalTemplatePath();
	if (!(await pathExists(filePath))) return null;
	return { filePath, scope: "global" };
}

export function renderTemplate(source: string, vars: TemplateVars): string {
	return createNunjucksEnv(vars).renderString(source, vars);
}

export function stripEmptyLines(text: string): string {
	return text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.trim().length > 0)
		.join("\n")
		.trim();
}

async function renderTemplateMatch(
	template: TemplateMatch,
	vars: TemplateVars,
): Promise<TemplateSection | null> {
	const source = await fs.readFile(template.filePath, "utf-8");
	const renderedPrompt = stripEmptyLines(renderTemplate(source, vars));
	if (!renderedPrompt) return null;

	return {
		...template,
		reminderType: template.scope === "global" ? "rules" : "project-rules",
		renderedPrompt,
	};
}

export async function renderTemplateSections(
	startCwd: string,
	vars: TemplateVars,
): Promise<TemplateSection[]> {
	const matches = [await findGlobalTemplate(), await findProjectTemplate(startCwd)].filter(
		(template): template is TemplateMatch => template !== null,
	);

	const sections = await Promise.all(
		matches.map((template) => renderTemplateMatch(template, vars)),
	);
	return sections.filter((section): section is TemplateSection => section !== null);
}

export async function renderTemplates(
	startCwd: string,
	vars: TemplateVars,
): Promise<string | null> {
	const sections = await renderTemplateSections(startCwd, vars);
	if (sections.length === 0) return null;
	return sections
		.map((section) => wrapSystemReminder(section.reminderType, section.renderedPrompt))
		.join("\n\n");
}

export function isSubagentRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_SUBAGENT?.trim() === "1";
}

export function parseDebugPromptOverrides(argv: string[]): {
	overrides: TemplateVars | null;
	error: string | null;
} {
	let rawValue: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--debug-prompt") {
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
				rawValue = next;
				i++;
			}
			continue;
		}

		if (arg.startsWith("--debug-prompt=")) {
			rawValue = arg.slice("--debug-prompt=".length);
		}
	}

	if (rawValue === undefined) {
		return { overrides: null, error: null };
	}

	const trimmedRawValue = rawValue.trim();
	if (!trimmedRawValue.startsWith("{")) {
		return { overrides: null, error: null };
	}

	try {
		const parsed = JSON.parse(trimmedRawValue);
		if (!isTemplateVarsObject(parsed)) {
			return {
				overrides: null,
				error:
					'--debug-prompt value must be a JSON object, e.g. --debug-prompt \'{"model":"claude-sonnet"}\'',
			};
		}

		return { overrides: parsed, error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			overrides: null,
			error: `Invalid --debug-prompt JSON: ${message}`,
		};
	}
}

export function getTemplateVars(
	ctx: TemplateContext,
	overrides?: TemplateVars | null,
): TemplateVars {
	const isSubagent = isSubagentRuntime();
	return {
		provider: ctx.model?.provider,
		model: ctx.model?.id,
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		isMainAgent: !isSubagent,
		isSubagent,
		...process.env,
		tools: ctx.tools ?? [],
		...overrides,
	};
}

export async function renderDynamicPrompt(
	ctx: TemplateContext,
	overrides?: TemplateVars | null,
): Promise<string | null> {
	return renderTemplates(ctx.cwd, getTemplateVars(ctx, overrides));
}

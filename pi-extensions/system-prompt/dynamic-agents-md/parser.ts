import { promises as fs } from "node:fs";
import path from "node:path";
import nunjucks from "nunjucks";
import { wrapSystemReminder } from "../../shared/xml.js";

export type TemplateMatch = {
	filePath: string;
	scope: "global" | "project";
};

export type RenderedTemplateSection = {
	scope: "global" | "project";
	reminderType: "rules" | "project-rules";
	filePath: string;
	renderedPrompt: string;
};

export type DynamicAgentsTemplateVars = Record<string, unknown>;

export const LOCAL_TEMPLATE_FILE = ".pi/agent.njk";
export const GLOBAL_TEMPLATE_FILE = "agent.njk";

function expandHomePrefix(input: string): string {
	if (input === "~") return process.env.HOME ?? "~";
	if (input.startsWith("~/")) {
		const home = process.env.HOME;
		if (!home) return input;
		return path.join(home, input.slice(2));
	}
	return input;
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

function createNunjucksEnv(vars: DynamicAgentsTemplateVars): nunjucks.Environment {
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

export async function pathExists(filePath: string): Promise<boolean> {
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

export async function findNearestProjectTemplate(startCwd: string): Promise<TemplateMatch | null> {
	let currentDir = path.resolve(startCwd);

	while (true) {
		const filePath = path.join(currentDir, LOCAL_TEMPLATE_FILE);
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

export async function findNearestTemplate(startCwd: string): Promise<TemplateMatch | null> {
	return (await findNearestProjectTemplate(startCwd)) ?? (await findGlobalTemplate());
}

export function renderTemplate(source: string, vars: DynamicAgentsTemplateVars): string {
	return createNunjucksEnv(vars).renderString(source, vars);
}

export { expandHomePrefix };

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
	vars: DynamicAgentsTemplateVars,
): Promise<RenderedTemplateSection | null> {
	const source = await fs.readFile(template.filePath, "utf-8");
	const renderedPrompt = stripEmptyLines(renderTemplate(source, vars));
	if (!renderedPrompt) return null;

	return {
		scope: template.scope,
		reminderType: template.scope === "global" ? "rules" : "project-rules",
		filePath: template.filePath,
		renderedPrompt,
	};
}

export async function renderTemplateSections(
	startCwd: string,
	vars: DynamicAgentsTemplateVars,
): Promise<RenderedTemplateSection[]> {
	const matches = [await findGlobalTemplate(), await findNearestProjectTemplate(startCwd)].filter(
		(template): template is TemplateMatch => template !== null,
	);

	const sections = await Promise.all(
		matches.map((template) => renderTemplateMatch(template, vars)),
	);
	return sections.filter((section): section is RenderedTemplateSection => section !== null);
}

export async function renderNearestTemplate(
	startCwd: string,
	vars: DynamicAgentsTemplateVars,
): Promise<{ filePath: string; renderedPrompt: string } | null> {
	const sections = await renderTemplateSections(startCwd, vars);
	if (sections.length === 0) return null;
	return {
		filePath: sections[sections.length - 1].filePath,
		renderedPrompt: sections
			.map((section) => wrapSystemReminder(section.reminderType, section.renderedPrompt))
			.join("\n\n"),
	};
}

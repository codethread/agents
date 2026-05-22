import type { BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { escapeXmlAttribute, wrapSystemReminder } from "../../shared/xml.js";

export type OwnedSkill = Pick<
	NonNullable<BuildSystemPromptOptions["skills"]>[number],
	"name" | "description" | "filePath"
> & {
	disableModelInvocation?: boolean;
};
export type OwnedContextFile = NonNullable<BuildSystemPromptOptions["contextFiles"]>[number];

export type OwnedPromptInput = {
	identity: string;
	cwd: string;
	currentDate: string;
	selectedTools: string[];
	toolSnippets: Record<string, string>;
	promptGuidelines: string[];
	toolGuidelines?: Record<string, string[]>;
	contextFiles: OwnedContextFile[];
	skills: OwnedSkill[];
	appendSystemPrompt?: string;
	dynamicPrompt?: string | null;
};

export type OwnedPromptDependencies = {
	wrapReminder: (type: string, content: string) => string;
};

export const DEFAULT_OWNED_IDENTITY =
	"You are an expert coding assistant operating inside pi, a coding agent harness.";

const DEFAULT_GUIDELINES = [
	"Be concise in your responses",
	"Show file paths clearly when working with files",
];

export function createOwnedPromptBuilder(
	dependencies: OwnedPromptDependencies = { wrapReminder: wrapSystemReminder },
) {
	return (input: OwnedPromptInput): string => buildOwnedSystemPrompt(input, dependencies);
}

function compact(lines: Array<string | null | undefined>): string[] {
	return lines.map((line) => line?.trim()).filter((line): line is string => Boolean(line));
}

function unique(lines: string[]): string[] {
	return [...new Set(compact(lines))];
}

function joinSections(sections: Array<string | null | undefined>): string {
	return compact(sections).join("\n\n");
}

function renderSection(title: string, intro: string, body: string | null | undefined): string | null {
	if (!body?.trim()) return null;
	return joinSections([`## ${title}`, intro, body]);
}

function bullet(lines: string[], indent = ""): string {
	return lines.map((line) => `${indent}- ${line}`).join("\n");
}

function orderTools(toolNames: string[]): string[] {
	return [...toolNames.filter((toolName) => toolName !== "subagent"), ...toolNames.filter((toolName) => toolName === "subagent")];
}

function toolSpecificGuidelines(toolGuidelines: Record<string, string[]> = {}): Set<string> {
	return new Set(Object.values(toolGuidelines).flat().map((guideline) => guideline.trim()));
}

export function renderOwnedTools({
	selectedTools,
	toolSnippets,
	toolGuidelines,
}: Pick<OwnedPromptInput, "selectedTools" | "toolSnippets" | "toolGuidelines">): string {
	if (selectedTools.length === 0) return "(none)";
	return orderTools(selectedTools)
		.map((toolName) =>
			[
				`- \`${toolName}\`${toolSnippets[toolName] ? `: ${toolSnippets[toolName]}` : ""}`,
				bullet(unique(toolGuidelines?.[toolName] ?? []), "  "),
			]
				.filter(Boolean)
				.join("\n"),
		)
		.join("\n");
}

export function renderOwnedGuidelines(
	input: string[] | Pick<OwnedPromptInput, "promptGuidelines" | "toolGuidelines">,
): string {
	const promptGuidelines = Array.isArray(input) ? input : input.promptGuidelines;
	const toolGuidelines = Array.isArray(input) ? undefined : input.toolGuidelines;
	const claimed = toolSpecificGuidelines(toolGuidelines);
	const generalGuidelines = promptGuidelines.filter((guideline) => !claimed.has(guideline.trim()));
	return bullet(unique([...generalGuidelines, ...DEFAULT_GUIDELINES]));
}

export function renderOwnedContextFiles(
	contextFiles: OwnedContextFile[],
	wrapReminder: OwnedPromptDependencies["wrapReminder"] = wrapSystemReminder,
): string | null {
	if (contextFiles.length === 0) return null;
	const files = contextFiles.map((file) =>
		joinSections([
			`<context-file path="${escapeXmlAttribute(file.path)}">`,
			file.content,
			"</context-file>",
		]),
	);
	return wrapReminder("project-context", joinSections(files));
}

export function renderOwnedSkills(skills: OwnedSkill[]): string | null {
	const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
	if (visibleSkills.length === 0) return null;

	return renderSection(
		"Skills",
		"Load these task-specific instructions only when the user request matches a skill description.",
		[
			"Use the read tool to load a skill's file when the task matches its description.",
			"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
			"",
			"<available_skills>",
			...visibleSkills.flatMap((skill) => [
				"  <skill>",
				`    <name>${skill.name}</name>`,
				`    <description>${skill.description}</description>`,
				`    <location>${skill.filePath}</location>`,
				"  </skill>",
			]),
			"</available_skills>",
		].join("\n"),
	);
}

export function buildOwnedSystemPrompt(
	input: OwnedPromptInput,
	{ wrapReminder }: OwnedPromptDependencies = { wrapReminder: wrapSystemReminder },
): string {
	const harness = wrapReminder(
		"harness",
		[
			"You help users by reading files, executing commands, editing code, and writing new files.",
			"",
			"General response guidelines:",
			renderOwnedGuidelines(input),
			"",
			"Available tools:",
			renderOwnedTools(input),
		].join("\n"),
	);

	return joinSections([
		input.identity,
		renderSection("Operating harness", "", harness),
		renderSection("Operating rules", "", input.dynamicPrompt),
		renderOwnedContextFiles(input.contextFiles, wrapReminder),
		renderOwnedSkills(input.skills),
		renderSection(
			"Session metadata",
			"",
			wrapReminder(
				"session-metadata",
				[`Current date: ${input.currentDate}`, `Current working directory: ${input.cwd}`].join("\n"),
			),
		),
		renderSection(
			"Additional system instructions",
			"Apply this explicit system-prompt addition after the owned prompt sections.",
			input.appendSystemPrompt,
		),
	]);
}

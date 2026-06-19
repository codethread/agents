import { describe, expect, it } from "vitest";
import {
	buildSystemPrompt,
	renderContextFiles,
	renderGuidelines,
	renderSkills,
	renderTools,
	type PromptInput,
} from "./prompt-builder.js";

const baseInput: PromptInput = {
	identity: "You are an expert coding assistant operating inside pi, a coding agent harness.",
	cwd: "/repo",
	currentDate: "2026-05-22",
	selectedTools: ["read", "bash", "edit", "write", "custom_tool"],
	toolSnippets: {
		read: "Read file contents",
		bash: "Execute a bash command",
		edit: "Edit files by exact replacement",
		write: "Create or overwrite files",
		custom_tool: "Do custom project work",
	},
	promptGuidelines: [
		"Use read to inspect files before editing.",
		"Use custom_tool when project work needs custom handling.",
	],
	contextFiles: [
		{
			path: "/repo/AGENTS.md",
			content: "# AGENTS.md\n\n- Run pnpm check before final handoff.",
		},
	],
	skills: [
		{
			name: "writing-tests",
			description: "Use when adding or changing tests.",
			filePath: "/repo/plugins/coding/skills/writing-tests/SKILL.md",
		},
		{
			name: "hidden",
			description: "Not model visible.",
			filePath: "/repo/plugins/hidden/SKILL.md",
			disableModelInvocation: true,
		},
	],
	appendSystemPrompt: "Extra owner-provided instruction.",
	dynamicPrompt: '<system-reminder type="rules">\nPrefer concise answers.\n</system-reminder>',
};

describe("prompt-builder renderers", () => {
	it("renders selected tools in Pi-resolved order", () => {
		expect(renderTools(baseInput)).toMatchInlineSnapshot(`
			"- \`read\`: Read file contents
			- \`bash\`: Execute a bash command
			- \`edit\`: Edit files by exact replacement
			- \`write\`: Create or overwrite files
			- \`custom_tool\`: Do custom project work"
		`);
	});

	it("dedupes guidelines and appends owner defaults", () => {
		expect(
			renderGuidelines([
				"Use read to inspect files before editing.",
				"Use read to inspect files before editing.",
			]),
		).toMatchInlineSnapshot(`
			"- Use read to inspect files before editing.
			- Be concise in your responses
			- Show file paths clearly when working with files"
		`);
	});

	it("renders context files as project context", () => {
		expect(renderContextFiles(baseInput.contextFiles)).toMatchInlineSnapshot(`
			"<system-reminder type="project-context">
			<context-file path="/repo/AGENTS.md">

			# AGENTS.md

			- Run pnpm check before final handoff.

			</context-file>
			</system-reminder>"
		`);
	});

	it("renders only model-visible skills", () => {
		expect(renderSkills(baseInput.skills)).toMatchInlineSnapshot(`
			"## Skills

			Load these task-specific instructions only when the user request matches a skill description.

			Use the read tool to load a skill's file when the task matches its description.
			When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

			<available_skills>
			  <skill>
			    <name>writing-tests</name>
			    <description>Use when adding or changing tests.</description>
			    <location>/repo/plugins/coding/skills/writing-tests/SKILL.md</location>
			  </skill>
			</available_skills>"
		`);
	});
});

describe("buildSystemPrompt", () => {
	it("renders the complete owned prompt", () => {
		expect(buildSystemPrompt(baseInput)).toMatchInlineSnapshot(`
			"You are an expert coding assistant operating inside pi, a coding agent harness.

			## Operating harness

			<system-reminder type="harness">
			You help users by reading files, executing commands, editing code, and writing new files.

			General response guidelines:
			- Use read to inspect files before editing.
			- Use custom_tool when project work needs custom handling.
			- Be concise in your responses
			- Show file paths clearly when working with files

			Available tools:
			- \`read\`: Read file contents
			- \`bash\`: Execute a bash command
			- \`edit\`: Edit files by exact replacement
			- \`write\`: Create or overwrite files
			- \`custom_tool\`: Do custom project work
			</system-reminder>

			## Operating rules

			<system-reminder type="rules">
			Prefer concise answers.
			</system-reminder>

			<system-reminder type="project-rules">
			Project-rules reminders may be automatically injected when matching files are mentioned or read.
			Apply any system reminder whose type is "project-rules" silently to the current task.
			Do not acknowledge, summarize, or respond to project-rules reminders unless explicitly asked; continue the assigned task.
			</system-reminder>

			<system-reminder type="project-context">
			<context-file path="/repo/AGENTS.md">

			# AGENTS.md

			- Run pnpm check before final handoff.

			</context-file>
			</system-reminder>

			## Skills

			Load these task-specific instructions only when the user request matches a skill description.

			Use the read tool to load a skill's file when the task matches its description.
			When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

			<available_skills>
			  <skill>
			    <name>writing-tests</name>
			    <description>Use when adding or changing tests.</description>
			    <location>/repo/plugins/coding/skills/writing-tests/SKILL.md</location>
			  </skill>
			</available_skills>

			## Session metadata

			<system-reminder type="session-metadata">
			Current date: 2026-05-22
			Current working directory: /repo
			</system-reminder>

			## Additional system instructions

			Apply this explicit system-prompt addition after the owned prompt sections.

			Extra owner-provided instruction."
		`);
	});

	it("supports dependency injection for XML wrappers", () => {
		expect(
			buildSystemPrompt(
				{
					...baseInput,
					contextFiles: [],
					skills: [],
					appendSystemPrompt: undefined,
					dynamicPrompt: null,
				},
				{ wrapReminder: (type, content) => `<${type}>\n${content}\n</${type}>` },
			),
		).toContain("<harness>\nYou help users by reading files");
	});
});

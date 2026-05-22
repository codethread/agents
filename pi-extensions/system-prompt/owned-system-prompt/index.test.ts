import { describe, expect, it } from "vitest";
import {
	buildOwnedSystemPrompt,
	createOwnedPromptBuilder,
	renderOwnedContextFiles,
	renderOwnedGuidelines,
	renderOwnedSkills,
	renderOwnedTools,
	type OwnedPromptInput,
} from "./index.js";

const baseInput: OwnedPromptInput = {
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
			filePath: "/repo/skills/writing-tests/SKILL.md",
		},
		{
			name: "hidden",
			description: "Not model visible.",
			filePath: "/repo/skills/hidden/SKILL.md",
			disableModelInvocation: true,
		},
	],
	appendSystemPrompt: "Extra owner-provided instruction.",
	dynamicPrompt: '<system-reminder type="rules">\nPrefer concise answers.\n</system-reminder>',
};

describe("owned-system-prompt renderers", () => {
	it("renders selected tools in Pi-resolved order", () => {
		expect(renderOwnedTools(baseInput)).toMatchInlineSnapshot(`
			"- \`read\`: Read file contents
			- \`bash\`: Execute a bash command
			- \`edit\`: Edit files by exact replacement
			- \`write\`: Create or overwrite files
			- \`custom_tool\`: Do custom project work"
		`);
	});

	it("dedupes guidelines and appends owner defaults", () => {
		expect(
			renderOwnedGuidelines([
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
		expect(renderOwnedContextFiles(baseInput.contextFiles)).toMatchInlineSnapshot(`
			"<system-reminder type="project-context">
			<context-file path="/repo/AGENTS.md">

			# AGENTS.md

			- Run pnpm check before final handoff.

			</context-file>
			</system-reminder>"
		`);
	});

	it("renders only model-visible skills", () => {
		expect(renderOwnedSkills(baseInput.skills)).toMatchInlineSnapshot(`
			"## Skills

			Load these task-specific instructions only when the user request matches a skill description.

			Use the read tool to load a skill's file when the task matches its description.
			When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

			<available_skills>
			  <skill>
			    <name>writing-tests</name>
			    <description>Use when adding or changing tests.</description>
			    <location>/repo/skills/writing-tests/SKILL.md</location>
			  </skill>
			</available_skills>"
		`);
	});
});

describe("buildOwnedSystemPrompt", () => {
	it("snapshots the complete owned prompt", () => {
		expect(buildOwnedSystemPrompt(baseInput)).toMatchSnapshot();
	});

	it("supports dependency injection for XML wrappers", () => {
		const build = createOwnedPromptBuilder({
			wrapReminder: (type, content) => `<${type}>\n${content}\n</${type}>`,
		});

		expect(
			build({
				...baseInput,
				contextFiles: [],
				skills: [],
				appendSystemPrompt: undefined,
				dynamicPrompt: null,
			}),
		).toContain("<harness>\nYou help users by reading files");
	});
});

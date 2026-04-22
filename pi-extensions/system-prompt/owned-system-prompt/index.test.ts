import { describe, expect, it } from "vitest";
import {
	buildOwnedGuidelines,
	buildOwnedPromptAddon,
	getOwnedBuiltinTools,
	shouldAppendOwnedPrompt,
} from "./index.js";

describe("owned-system-prompt helpers", () => {
	it("keeps builtin tool output in deterministic order", () => {
		expect(getOwnedBuiltinTools(["write", "custom", "read", "ls"])).toEqual([
			"read",
			"write",
			"ls",
		]);
	});

	it("builds owned guidelines for the default built-in tool set", () => {
		expect(buildOwnedGuidelines(["read", "bash", "edit", "write"])).toEqual([
			"Use bash for file operations like ls, rg, find",
			"Use read to examine files instead of cat or sed.",
			"Use edit for precise changes (edits[].oldText must match exactly)",
			"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
			"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
			"Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
			"Use write only for new files or complete rewrites.",
			"Be concise in your responses",
			"Show file paths clearly when working with files",
		]);
	});

	it("prefers dedicated exploration tools when grep/find/ls are active", () => {
		expect(buildOwnedGuidelines(["bash", "grep", "find", "ls"])).toContain(
			"Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)",
		);
		expect(buildOwnedGuidelines(["bash", "grep", "find", "ls"])).not.toContain(
			"Use bash for file operations like ls, rg, find",
		);
	});

	it("renders the owned prompt addon inside a system_reminder XML wrapper", () => {
		const prompt = buildOwnedPromptAddon(["read", "bash", "edit", "write"]);
		expect(prompt).toContain('<system-reminder type="harness">');
		expect(prompt).toContain(
			"Available tools:\n- read: Read file contents\n- bash: Execute bash commands (ls, grep, find, etc.)\n- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call\n- write: Create or overwrite files",
		);
		expect(prompt).toContain("Guidelines:\n- Use bash for file operations like ls, rg, find");
		expect(prompt).toContain("</system-reminder>");
	});

	it("skips prompt ownership when pi's default base prompt is still present", () => {
		expect(
			shouldAppendOwnedPrompt(
				"You are an expert coding assistant operating inside pi, a coding agent harness.\n\nPi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):",
			),
		).toBe(false);
		expect(
			shouldAppendOwnedPrompt(
				"You are an expert coding assistant operating inside pi, a coding agent harness.",
			),
		).toBe(true);
	});
});

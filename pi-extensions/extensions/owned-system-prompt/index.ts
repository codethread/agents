import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const DEFAULT_SYSTEM_PROMPT_SENTINEL =
	"Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):";

const BUILTIN_TOOL_ORDER = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

type BuiltinToolName = (typeof BUILTIN_TOOL_ORDER)[number];

const BUILTIN_TOOL_METADATA: Record<
	BuiltinToolName,
	{
		snippet: string;
		guidelines: string[];
	}
> = {
	read: {
		snippet: "Read file contents",
		guidelines: ["Use read to examine files instead of cat or sed."],
	},
	bash: {
		snippet: "Execute bash commands (ls, grep, find, etc.)",
		guidelines: [],
	},
	edit: {
		snippet:
			"Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
		guidelines: [
			"Use edit for precise changes (edits[].oldText must match exactly)",
			"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
			"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
			"Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
		],
	},
	write: {
		snippet: "Create or overwrite files",
		guidelines: ["Use write only for new files or complete rewrites."],
	},
	grep: {
		snippet: "Search file contents for patterns (respects .gitignore)",
		guidelines: [],
	},
	find: {
		snippet: "Find files by glob pattern (respects .gitignore)",
		guidelines: [],
	},
	ls: {
		snippet: "List directory contents",
		guidelines: [],
	},
};

function isBuiltinToolName(toolName: string): toolName is BuiltinToolName {
	return toolName in BUILTIN_TOOL_METADATA;
}

export function getOwnedBuiltinTools(activeTools: string[]): BuiltinToolName[] {
	const activeBuiltinTools = new Set(activeTools.filter(isBuiltinToolName));
	return BUILTIN_TOOL_ORDER.filter((toolName) => activeBuiltinTools.has(toolName));
}

export function buildOwnedGuidelines(activeTools: string[]): string[] {
	const activeToolsSet = new Set(activeTools);
	const guidelines: string[] = [];
	const seen = new Set<string>();
	const addGuideline = (guideline: string) => {
		const normalized = guideline.trim();
		if (normalized.length === 0 || seen.has(normalized)) return;
		seen.add(normalized);
		guidelines.push(normalized);
	};

	const hasBash = activeToolsSet.has("bash");
	const hasGrep = activeToolsSet.has("grep");
	const hasFind = activeToolsSet.has("find");
	const hasLs = activeToolsSet.has("ls");

	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline("Use bash for file operations like ls, rg, find");
	} else if (hasBash && (hasGrep || hasFind || hasLs)) {
		addGuideline(
			"Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)",
		);
	}

	for (const toolName of getOwnedBuiltinTools(activeTools)) {
		for (const guideline of BUILTIN_TOOL_METADATA[toolName].guidelines) {
			addGuideline(guideline);
		}
	}

	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");

	return guidelines;
}

export function buildOwnedPromptAddon(activeTools: string[]): string {
	const visibleTools = getOwnedBuiltinTools(activeTools);
	const toolsList =
		visibleTools.length > 0
			? visibleTools
					.map((toolName) => `- ${toolName}: ${BUILTIN_TOOL_METADATA[toolName].snippet}`)
					.join("\n")
			: "(none)";
	const guidelinesList = buildOwnedGuidelines(activeTools)
		.map((guideline) => `- ${guideline}`)
		.join("\n");

	return [
		"You help users by reading files, executing commands, editing code, and writing new files.",
		"",
		"Available tools:",
		toolsList,
		"",
		"In addition to the tools above, you may have access to other custom tools depending on the project.",
		"",
		"Guidelines:",
		guidelinesList,
	].join("\n");
}

export function shouldAppendOwnedPrompt(systemPrompt: string): boolean {
	return !systemPrompt.includes(DEFAULT_SYSTEM_PROMPT_SENTINEL);
}

function stripOuterEmptyLines(text: string): string {
	return text.trim();
}

export default function ownedSystemPromptExtension(pi: ExtensionAPI) {
	let printPromptOnNextTurn = false;
	let debugPromptTriggered = false;

	pi.registerFlag("debug-owned-prompt", {
		description: "Print the current effective system prompt and exit",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", (_event, ctx) => {
		if (pi.getFlag("debug-owned-prompt") !== true || debugPromptTriggered) return;
		debugPromptTriggered = true;
		printPromptOnNextTurn = true;
		pi.sendUserMessage("ping");
		if (ctx.hasUI) {
			ctx.ui.notify(
				"Debug owned prompt mode: starting a ping turn to materialize the prompt.",
				"info",
			);
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		if (!printPromptOnNextTurn) return;
		printPromptOnNextTurn = false;
		process.stdout.write(`${stripOuterEmptyLines(ctx.getSystemPrompt())}\n`);
		process.exit(0);
	});

	pi.on("before_agent_start", (event) => {
		if (!shouldAppendOwnedPrompt(event.systemPrompt)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildOwnedPromptAddon(pi.getActiveTools())}`,
		};
	});
}

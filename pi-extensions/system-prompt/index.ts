import type {
	BuildSystemPromptOptions,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { showDebugMessage } from "../components/debug-message/index.js";
import { DEFAULT_IDENTITY, buildSystemPrompt } from "./prompt-builder.js";
import { parseDebugPromptOverrides, renderDynamicPrompt, type TemplateVars } from "./templates.js";

const DEBUG_PROMPT_FLAG = "debug-prompt";

type ToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];
type ToolPromptMetadata = {
	promptGuidelines: string[];
};

type BeforeAgentStartEvent = {
	systemPrompt: string;
	systemPromptOptions?: Partial<BuildSystemPromptOptions>;
};

function trimOuterEmptyLines(text: string): string {
	return text.trim();
}

type OwnedSystemPromptOptions = Partial<BuildSystemPromptOptions> & {
	cwd: string;
	selectedTools: string[];
	toolSnippets: Record<string, string>;
	promptGuidelines: string[];
};

function getOwnedSystemPromptOptions(event: BeforeAgentStartEvent): OwnedSystemPromptOptions {
	const options = event.systemPromptOptions;
	if (!options)
		throw new Error("Pi did not provide systemPromptOptions for owned prompt rendering.");
	if (!options.cwd) throw new Error("Pi did not provide systemPromptOptions.cwd.");
	if (!options.selectedTools)
		throw new Error("Pi did not provide systemPromptOptions.selectedTools.");
	if (!options.toolSnippets)
		throw new Error("Pi did not provide systemPromptOptions.toolSnippets.");
	if (!options.promptGuidelines) {
		throw new Error("Pi did not provide systemPromptOptions.promptGuidelines.");
	}
	return options as OwnedSystemPromptOptions;
}

function notify(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	message: string,
	level: "info" | "warning" | "error",
) {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

function mentionsTool(guideline: string, toolName: string): boolean {
	return new RegExp(
		`(^|[^a-z0-9_\\-])${toolName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^a-z0-9_\\-]|$)`,
		"i",
	).test(guideline);
}

function groupToolGuidelines(
	selectedTools: string[],
	promptGuidelines: string[],
	metadata: Map<string, ToolPromptMetadata>,
): Record<string, string[]> {
	const grouped: Record<string, string[]> = {};
	const claimed = new Set<string>();
	const addGuideline = (toolName: string, guideline: string) => {
		const normalized = guideline.trim();
		if (!normalized) return;
		grouped[toolName] ??= [];
		if (!grouped[toolName].includes(normalized)) grouped[toolName].push(normalized);
		claimed.add(normalized);
	};

	for (const toolName of selectedTools) {
		for (const guideline of metadata.get(toolName)?.promptGuidelines ?? []) {
			addGuideline(toolName, guideline);
		}
	}

	let currentTool: string | undefined;
	for (const guideline of promptGuidelines) {
		const normalized = guideline.trim();
		if (!normalized) continue;
		const matchingTool = selectedTools.find((toolName) => mentionsTool(normalized, toolName));
		currentTool = matchingTool ?? currentTool;
		if (currentTool && !claimed.has(normalized)) addGuideline(currentTool, normalized);
	}

	return grouped;
}

export default function systemPromptExtension(pi: ExtensionAPI) {
	let printPromptOnNextTurn = false;
	let debugPromptOverrides: TemplateVars | null = null;
	let lastMaterializedPrompt: string | null = null;
	const toolPromptMetadata = new Map<string, ToolPromptMetadata>();
	const registerTool = pi.registerTool.bind(pi);
	pi.registerTool = ((definition: ToolDefinition) => {
		toolPromptMetadata.set(definition.name, {
			promptGuidelines: definition.promptGuidelines ?? [],
		});
		registerTool(definition);
	}) as ExtensionAPI["registerTool"];


	pi.registerFlag(DEBUG_PROMPT_FLAG, {
		description:
			"Print the current effective system prompt and exit (optionally with a JSON override arg)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("debug-prompt", {
		description: "Show the last materialized effective system prompt",
		handler: async (_args, ctx) => {
			const prompt = lastMaterializedPrompt;
			if (!prompt) {
				const message =
					"No materialized system prompt yet. Send a message first, then rerun /debug-prompt.";
				if (!ctx.hasUI) process.stderr.write(`${message}\n`);
				else notify(ctx, message, "warning");
				return;
			}

			if (!ctx.hasUI) {
				process.stdout.write(`${prompt}\n`);
				return;
			}

			await showDebugMessage(ctx, {
				headingText: "Debug Prompt",
				subheadingText: "last materialized effective prompt",
				markdownBody: prompt,
				sendMarkdownToAgent: async () => {
					await pi.sendUserMessage(prompt);
				},
			});
		},
	});

	pi.on("session_start", (_event, ctx) => {
		printPromptOnNextTurn = false;
		debugPromptOverrides = null;
		lastMaterializedPrompt = null;

		const wantsPromptDebug = pi.getFlag(DEBUG_PROMPT_FLAG) === true;
		if (!wantsPromptDebug) return;

		const parsedOverrides = parseDebugPromptOverrides(process.argv.slice(2));
		if (parsedOverrides.error) {
			notify(ctx, parsedOverrides.error, "error");
			process.stderr.write(`${parsedOverrides.error}\n`);
			process.exit(1);
		}
		debugPromptOverrides = parsedOverrides.overrides;

		printPromptOnNextTurn = true;
		notify(ctx, "Debug prompt mode: send a message to materialize the prompt.", "info");
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		const options = getOwnedSystemPromptOptions(event);
		const dynamicPrompt = await renderDynamicPrompt(
			{
				cwd: options.cwd,
				hasUI: ctx.hasUI,
				model: ctx.model,
				tools: options.selectedTools,
			},
			printPromptOnNextTurn ? debugPromptOverrides : null,
		);

		return {
			systemPrompt: buildSystemPrompt({
				identity: options.customPrompt?.trim() || DEFAULT_IDENTITY,
				cwd: options.cwd,
				currentDate: new Date().toISOString().slice(0, 10),
				selectedTools: options.selectedTools,
				toolSnippets: options.toolSnippets,
				promptGuidelines: options.promptGuidelines,
				toolGuidelines: groupToolGuidelines(
					options.selectedTools,
					options.promptGuidelines,
					toolPromptMetadata,
				),
				contextFiles: options.contextFiles ?? [],
				skills: options.skills ?? [],
				appendSystemPrompt: options.appendSystemPrompt,
				dynamicPrompt,
			}),
		};
	});

	pi.on("agent_start", (_event, ctx) => {
		const prompt = trimOuterEmptyLines(ctx.getSystemPrompt());
		if (prompt) lastMaterializedPrompt = prompt;
		if (!printPromptOnNextTurn) return;
		printPromptOnNextTurn = false;
		debugPromptOverrides = null;
		process.stdout.write(`${prompt}\n`);
		process.exit(0);
	});
}

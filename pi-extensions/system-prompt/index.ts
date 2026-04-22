import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { showDebugMessage } from "../components/debug-message/index.js";
import {
	parseDebugPromptOverrides,
	renderDynamicAgentsPrompt,
	type DynamicAgentsTemplateVars,
} from "./dynamic-agents-md/index.js";
import { buildOwnedPromptAddon, shouldAppendOwnedPrompt } from "./owned-system-prompt/index.js";
import {
	createProjectStructurePromptController,
	INVALIDATING_TOOLS,
} from "./project-structure-prompt/index.js";

const DEBUG_PROMPT_FLAG = "debug-prompt";

type BeforeAgentStartEvent = {
	systemPrompt: string;
	systemPromptOptions?: {
		selectedTools?: string[];
	};
};

type ToolExecutionEndEvent = {
	toolName: string;
};

function trimOuterEmptyLines(text: string): string {
	return text.trim();
}

function formatPromptForDebugDisplay(prompt: string): string {
	return `\`\`\`\`text
${prompt}
\`\`\`\``;
}

function appendPromptSection(systemPrompt: string, section: string | null | undefined): string {
	return section ? `${systemPrompt}\n\n${section}` : systemPrompt;
}

function getSelectedToolsFromEvent(
	event: BeforeAgentStartEvent,
	getFallbackTools: () => string[],
): string[] {
	const selectedTools = event.systemPromptOptions?.selectedTools;
	return Array.isArray(selectedTools) ? selectedTools : getFallbackTools();
}

function notify(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	message: string,
	level: "info" | "warning" | "error",
) {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

export default function systemPromptExtension(pi: ExtensionAPI) {
	let printPromptOnNextTurn = false;
	let debugPromptTriggered = false;
	let debugPromptOverrides: DynamicAgentsTemplateVars | null = null;
	let lastMaterializedPrompt: string | null = null;
	let waitForDebugPromptMaterialization: Promise<void> | null = null;
	let resolveDebugPromptMaterialization: (() => void) | null = null;

	const projectStructure = createProjectStructurePromptController((command, args, options) =>
		pi.exec(command, args, options),
	);

	const queuePromptDebugTurn = async (
		ctx: Pick<ExtensionContext, "hasUI" | "ui">,
		message: string,
	) => {
		printPromptOnNextTurn = true;
		if (debugPromptTriggered) return;
		debugPromptTriggered = true;
		waitForDebugPromptMaterialization = new Promise<void>((resolve) => {
			resolveDebugPromptMaterialization = resolve;
		});
		notify(ctx, message, "info");
		await pi.sendUserMessage("ping");
		if (!ctx.hasUI && waitForDebugPromptMaterialization) {
			await waitForDebugPromptMaterialization;
		}
	};

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
				markdownBody: formatPromptForDebugDisplay(prompt),
				sendMarkdownToAgent: async () => {
					await pi.sendUserMessage(prompt);
				},
			});
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		projectStructure.reset();
		printPromptOnNextTurn = false;
		debugPromptTriggered = false;
		debugPromptOverrides = null;
		lastMaterializedPrompt = null;
		waitForDebugPromptMaterialization = null;
		resolveDebugPromptMaterialization = null;
		projectStructure.prime(ctx);

		const wantsPromptDebug = pi.getFlag(DEBUG_PROMPT_FLAG) === true;
		if (!wantsPromptDebug) return;

		const parsedOverrides = parseDebugPromptOverrides(process.argv.slice(2));
		if (parsedOverrides.error) {
			notify(ctx, parsedOverrides.error, "error");
			process.stderr.write(`${parsedOverrides.error}\n`);
			process.exit(1);
		}
		debugPromptOverrides = parsedOverrides.overrides;

		await queuePromptDebugTurn(
			ctx,
			"Debug prompt mode: starting a ping turn to materialize the prompt.",
		);
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		const selectedTools = getSelectedToolsFromEvent(event, () => pi.getActiveTools());
		let systemPrompt = event.systemPrompt;

		if (shouldAppendOwnedPrompt(systemPrompt)) {
			systemPrompt = appendPromptSection(systemPrompt, buildOwnedPromptAddon(selectedTools));
		}

		const dynamicPrompt = await renderDynamicAgentsPrompt(
			{
				cwd: ctx.cwd,
				hasUI: ctx.hasUI,
				model: ctx.model,
				tools: selectedTools,
			},
			printPromptOnNextTurn ? debugPromptOverrides : null,
		);
		systemPrompt = appendPromptSection(systemPrompt, dynamicPrompt);

		const projectStructurePrompt = await projectStructure.getPrompt(ctx);
		systemPrompt = appendPromptSection(systemPrompt, projectStructurePrompt);

		if (systemPrompt === event.systemPrompt) return;
		return { systemPrompt };
	});

	pi.on("agent_start", (_event, ctx) => {
		const prompt = trimOuterEmptyLines(ctx.getSystemPrompt());
		if (prompt) lastMaterializedPrompt = prompt;
		if (!printPromptOnNextTurn) return;
		printPromptOnNextTurn = false;
		debugPromptOverrides = null;
		resolveDebugPromptMaterialization?.();
		resolveDebugPromptMaterialization = null;
		waitForDebugPromptMaterialization = null;
		process.stdout.write(`${prompt}\n`);
		process.exit(0);
	});

	pi.on("tool_execution_end", async (event: ToolExecutionEndEvent) => {
		if (INVALIDATING_TOOLS.has(event.toolName)) {
			projectStructure.invalidate();
		}
	});
}

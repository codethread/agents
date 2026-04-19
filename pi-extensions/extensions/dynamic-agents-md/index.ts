import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { renderNearestTemplate, type DynamicAgentsTemplateVars } from "./parser.js";

function getEditorCommand(): string | undefined {
	const visual = process.env.VISUAL?.trim();
	if (visual) return visual;
	const editor = process.env.EDITOR?.trim();
	if (editor) return editor;
	return undefined;
}

function isTemplateVarsObject(value: unknown): value is DynamicAgentsTemplateVars {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSubagentRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_SUBAGENT?.trim() === "1";
}

export function parseDebugPromptOverrides(argv: string[]): {
	overrides: DynamicAgentsTemplateVars | null;
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
	ctx: {
		cwd: string;
		hasUI: boolean;
		tools?: string[];
		model?: {
			provider?: string;
			id?: string;
		} | null;
	},
	overrides?: DynamicAgentsTemplateVars | null,
): DynamicAgentsTemplateVars {
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

function trimOuterEmptyLines(text: string): string {
	return text.trim();
}

function openExternalEditor(
	editorCommand: string,
	filePath: string,
): { ok: true } | { ok: false; message: string } {
	const result = spawnSync(editorCommand, [filePath], {
		shell: true,
		stdio: "inherit",
	});

	if (result.error) {
		return { ok: false, message: `failed to start editor: ${result.error.message}` };
	}

	if (result.status === 0) return { ok: true };

	return { ok: false, message: `editor exited with status ${result.status ?? "unknown"}` };
}

export default function dynamicAgentsMdExtension(pi: ExtensionAPI) {
	let printPromptOnNextTurn = false;
	let debugPromptTriggered = false;
	let debugPromptOverrides: DynamicAgentsTemplateVars | null = null;
	let waitForDebugPromptMaterialization: Promise<void> | null = null;
	let resolveDebugPromptMaterialization: (() => void) | null = null;

	pi.registerFlag("debug-prompt", {
		description:
			"Print the current effective system prompt and exit (optionally with a JSON override arg)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("debug-prompt", {
		description: "Open the current effective system prompt in an external editor",
		handler: async (_args, ctx) => {
			const prompt = trimOuterEmptyLines(ctx.getSystemPrompt());
			if (!prompt) {
				ctx.ui.notify("No system prompt available", "info");
				return;
			}

			const editor = getEditorCommand();
			if (!editor) {
				ctx.ui.notify("No external editor configured. Set $VISUAL or $EDITOR.", "warning");
				return;
			}

			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-debug-prompt-"));
			const filePath = path.join(tmpDir, "system-prompt.md");
			await fs.writeFile(filePath, prompt, "utf-8");
			const result = openExternalEditor(editor, filePath);
			if (!result.ok) {
				ctx.ui.notify(result.message, "error");
				return;
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("debug-prompt")) {
			const parsedOverrides = parseDebugPromptOverrides(process.argv.slice(2));
			if (parsedOverrides.error) {
				ctx.ui.notify(parsedOverrides.error, "error");
				process.stderr.write(`${parsedOverrides.error}\n`);
				process.exit(1);
			}

			debugPromptOverrides = parsedOverrides.overrides;
			printPromptOnNextTurn = true;
			if (!debugPromptTriggered) {
				debugPromptTriggered = true;
				waitForDebugPromptMaterialization = new Promise<void>((resolve) => {
					resolveDebugPromptMaterialization = resolve;
				});
				ctx.ui.notify("Debug prompt mode: starting a ping turn to materialize the prompt.", "info");
				await pi.sendUserMessage("ping");
				if (!ctx.hasUI && waitForDebugPromptMaterialization) {
					await waitForDebugPromptMaterialization;
				}
			}
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		if (printPromptOnNextTurn) {
			printPromptOnNextTurn = false;
			resolveDebugPromptMaterialization?.();
			resolveDebugPromptMaterialization = null;
			waitForDebugPromptMaterialization = null;
			process.stdout.write(`${trimOuterEmptyLines(ctx.getSystemPrompt())}\n`);
			process.exit(0);
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const rendered = await renderNearestTemplate(
			ctx.cwd,
			getTemplateVars(
				{
					...ctx,
					tools: pi.getActiveTools(),
				},
				printPromptOnNextTurn ? debugPromptOverrides : null,
			),
		);
		if (!rendered) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${rendered.renderedPrompt}`,
		};
	});
}

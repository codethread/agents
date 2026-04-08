import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { renderNearestTemplate, stripEmptyLines } from "./parser.js";

function getEditorCommand(): string | undefined {
	const visual = process.env.VISUAL?.trim();
	if (visual) return visual;
	const editor = process.env.EDITOR?.trim();
	if (editor) return editor;
	return undefined;
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

	pi.registerFlag("debug-prompt", {
		description: "Print the current effective system prompt and exit",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("debug-prompt", {
		description: "Open the current effective system prompt in an external editor",
		handler: async (_args, ctx) => {
			const prompt = stripEmptyLines(ctx.getSystemPrompt());
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

	pi.on("session_start", (_event, ctx) => {
		if (pi.getFlag("debug-prompt")) {
			printPromptOnNextTurn = true;
			if (!debugPromptTriggered) {
				debugPromptTriggered = true;
				pi.sendUserMessage("ping");
				ctx.ui.notify("Debug prompt mode: starting a ping turn to materialize the prompt.", "info");
			}
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		if (printPromptOnNextTurn) {
			printPromptOnNextTurn = false;
			process.stdout.write(`${stripEmptyLines(ctx.getSystemPrompt())}\n`);
			process.exit(0);
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const rendered = await renderNearestTemplate(ctx.cwd, {
			provider: ctx.model?.provider,
			model: ctx.model?.id,
			cwd: ctx.cwd,
			...process.env,
		});
		if (!rendered) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${rendered.renderedPrompt}`,
		};
	});
}

import { existsSync } from "node:fs";
import * as path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

function buildShellCommand(invocation: { command: string; args: string[] }): string {
	return [invocation.command, ...invocation.args].map(shellQuote).join(" ");
}

const MODEL_CHOICES = [
	"openai-codex/gpt-5.5",
	"openai-codex/gpt-5.4",
	"openai-codex/gpt-5.4-mini",
	"anthropic/claude-haiku-4-5",
	"anthropic/claude-sonnet-4-6",
	"anthropic/claude-opus-4-6",
	"anthropic/claude-opus-4-8",
] as const;

function formatModelRef(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

async function selectModelArgs(ctx: ExtensionCommandContext): Promise<string[] | undefined> {
	const availableModels = await ctx.modelRegistry.getAvailable();
	const availableRefs = new Set(availableModels.map(formatModelRef));
	const currentModelRef = ctx.model ? formatModelRef(ctx.model) : undefined;
	const selectableModelRefs = MODEL_CHOICES.filter((modelRef) => availableRefs.has(modelRef));

	if (selectableModelRefs.length === 0) {
		ctx.ui.notify("/fork-off could not find any authenticated preferred models", "error");
		return undefined;
	}

	const defaultChoice = currentModelRef && selectableModelRefs.some((modelRef) => modelRef === currentModelRef)
		? currentModelRef
		: selectableModelRefs[0];
	const orderedModelRefs = [
		defaultChoice,
		...selectableModelRefs.filter((modelRef) => modelRef !== defaultChoice),
	];
	const choices = orderedModelRefs.map((modelRef, index) => {
		const current = modelRef === currentModelRef ? " (current)" : "";
		const selected = index === 0 ? " (default)" : "";
		return `${modelRef}${current}${selected}`;
	});

	const selected = await ctx.ui.select("Model for forked session:", choices);
	if (!selected) return undefined;

	const selectedModelRef = selected.replace(/ \(current\)/, "").replace(/ \(default\)/, "");
	return ["--model", selectedModelRef];
}

export default function forkOffExtension(pi: ExtensionAPI) {
	pi.registerCommand("fork-off", {
		description: "Open a tmux window with a fork of the current session",
		handler: async (args, ctx) => {
			const queued = !ctx.isIdle();
			if (queued) {
				ctx.ui.notify("/fork-off queued; will open after the current agent turn finishes", "info");
				ctx.ui.setStatus("fork-off", "fork-off queued");
			}

			await ctx.waitForIdle();
			ctx.ui.setStatus("fork-off", undefined);

			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("/fork-off requires a persisted session; this session is ephemeral", "error");
				return;
			}

			if (!process.env.TMUX?.trim()) {
				ctx.ui.notify("/fork-off requires tmux; TMUX is not set", "error");
				return;
			}

			const extraArgs = args.trim() ? args.trim().split(/\s+/) : await selectModelArgs(ctx);
			if (!extraArgs) return;

			const invocation = getPiInvocation(["--fork", sessionFile, ...extraArgs]);
			const piCommand = buildShellCommand(invocation);
			const shellCommand = `${piCommand}; exec ${process.env.SHELL ? shellQuote(process.env.SHELL) : "$SHELL"}`;
			const tmuxArgs = ["new-window", "-c", ctx.cwd, "sh", "-lc", shellCommand];

			try {
				const result = await pi.exec("tmux", tmuxArgs, { timeout: 5000 });
				if (result.code !== 0) {
					const message =
						result.stderr.trim() || result.stdout.trim() || `tmux exited with code ${result.code}`;
					ctx.ui.notify(`/fork-off failed: ${message}`, "error");
					return;
				}

				ctx.ui.notify("Opened forked pi session in a new tmux window", "info");
			} catch (error) {
				ctx.ui.notify(`/fork-off failed: ${getErrorMessage(error)}`, "error");
			}
		},
	});
}

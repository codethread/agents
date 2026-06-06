import { existsSync } from "node:fs";
import * as path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter } from "@earendil-works/pi-tui";

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
	const choices = orderedModelRefs.map((modelRef, index) => ({
		value: modelRef,
		label: `${modelRef}${modelRef === currentModelRef ? " (current)" : ""}${index === 0 ? " (default)" : ""}`,
	}));

	const selected = await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
		let query = "";
		let selectedIndex = 0;

		function getFilteredChoices() {
			return query.trim()
				? fuzzyFilter(choices, query.trim(), (choice) => choice.label)
				: choices;
		}

		function move(delta: number) {
			const filteredChoices = getFilteredChoices();
			if (filteredChoices.length === 0) return;
			selectedIndex = (selectedIndex + delta + filteredChoices.length) % filteredChoices.length;
		}

		function mutateQuery(nextQuery: string) {
			query = nextQuery;
			selectedIndex = 0;
		}

		return {
			render(width: number) {
				const filteredChoices = getFilteredChoices();
				const horizontalPadding = "  ";
				const contentWidth = Math.max(20, width - horizontalPadding.length * 2);
				const border = `${horizontalPadding}${theme.fg("accent", "─".repeat(contentWidth))}`;
				const padded = (line: string) => `${horizontalPadding}${line}`;
				const lines = [
					"",
					border,
					padded(theme.fg("accent", theme.bold("Model for forked session"))),
					padded(`${theme.fg("muted", "Search:")} ${query || theme.fg("dim", "type to fuzzy filter")}`),
				];

				if (filteredChoices.length === 0) {
					lines.push(padded(theme.fg("warning", "No matching models")));
				} else {
					for (const [index, choice] of filteredChoices.entries()) {
						const prefix = index === selectedIndex ? "› " : "  ";
						const text = `${prefix}${choice.label}`;
						lines.push(padded(index === selectedIndex ? theme.fg("accent", text) : text));
					}
				}

				lines.push(padded(theme.fg("dim", "↑↓ navigate • type search • backspace edit • enter select • esc cancel")));
				lines.push(border);
				lines.push("");
				return lines;
			},
			invalidate() {},
			handleInput(data: string) {
				if (data === "\u001b") {
					done(undefined);
					return;
				}
				if (data === "\r" || data === "\n") {
					const filteredChoices = getFilteredChoices();
					done(filteredChoices[selectedIndex]?.value);
					return;
				}
				if (data === "\u001b[A") move(-1);
				else if (data === "\u001b[B") move(1);
				else if (data === "\u007f" || data === "\b") mutateQuery(query.slice(0, -1));
				else if (data.length === 1 && data >= " " && data !== "\u007f") mutateQuery(query + data);
				tui.requestRender();
			},
		};
	}, { overlay: true });

	return selected ? ["--model", selected] : undefined;
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

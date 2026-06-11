import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import { InteractiveShellManager, TmuxCommandRunner, type ShellRecord } from "./shell-manager.js";

const DEFAULT_TAIL_LINES = 100;
const DEBUG_INTERACTIVE_SHELL_FLAG = "debug-interactive-shell";

const InteractiveShellParams = Type.Object({
	action: Type.Union(
		[
			Type.Literal("spawn"),
			Type.Literal("send"),
			Type.Literal("tail"),
			Type.Literal("list"),
			Type.Literal("kill"),
		],
		{
			description: "Operation to run: spawn, send, tail, list, or kill.",
		},
	),
	shellId: Type.Optional(
		Type.String({
			description: "Target shell id returned by spawn/list. Defaults to the latest shell.",
		}),
	),
	text: Type.Optional(
		Type.String({
			description: "Literal text for send. Multiline text is pasted into the shell.",
		}),
	),
	submit: Type.Optional(
		Type.Boolean({
			description: "For send, press Enter after any text. Use true by itself to submit.",
		}),
	),
	lines: Type.Optional(
		Type.Integer({
			description: "Number of output lines for tail. Defaults to 100.",
			minimum: 1,
			default: DEFAULT_TAIL_LINES,
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for spawn. Defaults to the current Pi cwd.",
		}),
	),
	name: Type.Optional(
		Type.String({
			description:
				"Friendly name for spawn, shown in /shells and list. Must be 80 characters or fewer.",
			maxLength: 80,
		}),
	),
});

type InteractiveShellParams = Static<typeof InteractiveShellParams>;

interface InteractiveShellDetails {
	action: InteractiveShellParams["action"];
	shell?: ShellRecord;
	shells?: ShellRecord[];
	output?: string;
}

function ok(text: string, details: InteractiveShellDetails) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

function fail(message: string, details: InteractiveShellDetails) {
	return {
		content: [{ type: "text" as const, text: `Error: ${message}` }],
		details,
		isError: true,
	};
}

function formatShell(record: ShellRecord): string {
	return `${record.id} — ${record.name} — ${record.shell}`;
}

function getTextContent(result: { content?: Array<{ type: string; text?: string }> }): string {
	const first = result.content?.find((item) => item.type === "text");
	return first?.type === "text" ? (first.text ?? "") : "";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatShellChoice(record: ShellRecord): string {
	return `${record.name} — ${record.id} — ${record.cwd}`;
}

async function pickShell(
	ctx: ExtensionCommandContext,
	shells: ShellRecord[],
): Promise<ShellRecord | undefined> {
	if (shells.length === 1) return shells[0];

	const choices = shells.map((shell) => ({
		value: shell,
		label: formatShellChoice(shell),
	}));

	return ctx.ui.custom<ShellRecord | undefined>(
		(tui, theme, _keybindings, done) => {
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
						padded(theme.fg("accent", theme.bold("Interactive shells"))),
						padded(
							`${theme.fg("muted", "Search:")} ${query || theme.fg("dim", "type to fuzzy filter")}`,
						),
					];

					if (filteredChoices.length === 0) {
						lines.push(padded(theme.fg("warning", "No matching shells")));
					} else {
						for (const [index, choice] of filteredChoices.entries()) {
							const prefix = index === selectedIndex ? "› " : "  ";
							const text = `${prefix}${choice.label}`;
							lines.push(padded(index === selectedIndex ? theme.fg("accent", text) : text));
						}
					}

					lines.push(
						padded(
							theme.fg(
								"dim",
								"↑↓ navigate • type search • backspace edit • enter jump • esc cancel",
							),
						),
					);
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
		},
		{ overlay: true },
	);
}

async function openShellPicker(
	manager: InteractiveShellManager,
	ctx: ExtensionCommandContext,
	exec: ExtensionAPI["exec"],
): Promise<void> {
	const shells = await manager.list();
	if (shells.length === 0) {
		ctx.ui.notify("No interactive shells running", "info");
		return;
	}
	if (!process.env.TMUX?.trim()) {
		ctx.ui.notify("/shells requires tmux; TMUX is not set", "error");
		return;
	}

	const selected = await pickShell(ctx, shells);
	if (!selected) return;

	const result = await exec("tmux", ["switch-client", "-t", selected.sessionName], {
		timeout: 5000,
	});
	if (result.code !== 0) {
		const message =
			result.stderr.trim() || result.stdout.trim() || `tmux exited with code ${result.code}`;
		ctx.ui.notify(`/shells failed: ${message}`, "error");
	}
}

async function runDebugInteractiveShell(
	manager: InteractiveShellManager,
	command: string,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	const shell = await manager.spawn(cwd, "debug", signal);
	if (command.trim()) {
		await manager.send({ shellId: shell.id, text: command, submit: true, signal });
		await sleep(500);
	}
	const output = await manager.tail(shell.id, DEFAULT_TAIL_LINES, signal);
	await manager.kill(shell.id, signal);

	const payload = {
		shell,
		output,
	};
	process.stdout.write(`${JSON.stringify(payload, null, "\t")}\n`);
	process.exit(0);
}

export default function interactiveShell(pi: ExtensionAPI) {
	const manager = new InteractiveShellManager(new TmuxCommandRunner());

	pi.registerFlag(DEBUG_INTERACTIVE_SHELL_FLAG, {
		description:
			"Run interactive_shell spawn/send/tail/kill directly; optionally send the given command first",
		type: "string",
	});

	pi.registerCommand("shells", {
		description: "Pick and jump to an active interactive_shell tmux session",
		handler: async (_args, ctx) => {
			try {
				await openShellPicker(manager, ctx, (command, args, options) =>
					pi.exec(command, args, options),
				);
			} catch (error) {
				ctx.ui.notify(`/shells failed: ${getErrorMessage(error)}`, "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const debugCommand = pi.getFlag(DEBUG_INTERACTIVE_SHELL_FLAG);
		if (typeof debugCommand !== "string") return;
		try {
			await runDebugInteractiveShell(manager, debugCommand, ctx.cwd, ctx.signal);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`${message}\n`);
			process.exit(1);
		}
	});

	pi.registerTool({
		name: "interactive_shell",
		label: "Interactive Shell",
		description:
			"Spawn and control interactive shell tmux sessions. Supports creating a shell, sending input, tailing output, listing spawned shells, and killing a shell.",
		promptSnippet: "Spawn and control interactive shell tmux sessions",
		promptGuidelines: [
			"Use interactive_shell for TUIs, REPLs, dev servers, and commands that need later input or output inspection.",
			"Use interactive_shell action=spawn with a short friendly name to create a shell first, then action=send to type commands into it.",
			"interactive_shell serializes send calls; when submit is true, text and Enter are sent as one ordered operation.",
			"Never call interactive_shell send, tail, or kill in the same tool-call batch as spawn; wait for the spawn result and shell id first.",
			"When creating multiple shells, spawn them one at a time; each shell is created in its own tmux session.",
			"Use interactive_shell action=list to refresh shell ids before targeting older shells.",
		],
		parameters: InteractiveShellParams,

		async execute(_toolCallId, params: InteractiveShellParams, signal, _onUpdate, ctx) {
			try {
				switch (params.action) {
					case "spawn": {
						const shell = await manager.spawn(params.cwd ?? ctx.cwd, params.name, signal);
						return ok(`Spawned ${formatShell(shell)}`, { action: params.action, shell });
					}
					case "send": {
						const shell = await manager.send({
							shellId: params.shellId,
							text: params.text,
							submit: params.submit,
							signal,
						});
						return ok(`Sent input to ${shell.id}`, { action: params.action, shell });
					}
					case "tail": {
						const output = await manager.tail(
							params.shellId,
							params.lines ?? DEFAULT_TAIL_LINES,
							signal,
						);
						return ok(output || "(no output)", { action: params.action, output });
					}
					case "list": {
						const shells = await manager.list(signal);
						const text = shells.length ? shells.map(formatShell).join("\n") : "No shells running.";
						return ok(text, { action: params.action, shells });
					}
					case "kill": {
						const shell = await manager.kill(params.shellId, signal);
						return ok(`Killed ${formatShell(shell)}`, { action: params.action, shell });
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return fail(message, { action: params.action });
			}
		},

		renderCall(args, theme) {
			const target = args.shellId ? ` ${args.shellId}` : "";
			return new Text(
				theme.fg("toolTitle", theme.bold("interactive_shell ")) +
					theme.fg("accent", `${args.action}${target}`),
				0,
				0,
			);
		},

		renderResult(result, options, theme) {
			if (options.isPartial) return new Text(theme.fg("warning", "Running..."), 0, 0);
			const text = getTextContent(result).trimEnd();
			if (!text) return new Text(theme.fg("dim", "(no output)"), 0, 0);
			const lines = text.split("\n");
			const shown = options.expanded ? lines : lines.slice(0, 5);
			let rendered = shown.map((line) => theme.fg("toolOutput", line)).join("\n");
			if (!options.expanded && lines.length > shown.length) {
				rendered += `\n${theme.fg("muted", `... ${lines.length - shown.length} more lines (Ctrl+o to expand)`)}`;
			}
			return new Text(rendered, 0, 0);
		},
	});
}

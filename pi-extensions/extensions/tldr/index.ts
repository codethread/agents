import { complete, type Model } from "@mariozechner/pi-ai";
import {
	DynamicBorder,
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@mariozechner/pi-tui";
import {
	buildConversationTranscript,
	buildTldrPrompt,
	extractSummaryFromResponse,
	formatModelRef,
	pickTldrModel,
} from "./summary.js";

type TldrResult = {
	transcript: string;
	summary: string;
	model: Model<any>;
};

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function notify(
	ctx: ExtensionContext,
	message: string,
	level: "info" | "warning" | "error" = "info",
) {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}

	const stream = level === "error" ? process.stderr : process.stdout;
	stream.write(`${message}\n`);
}

function formatDebugNotes(notes: readonly string[], maxItems = 3): string {
	if (notes.length === 0) return "";
	const head = notes.slice(0, maxItems).join(" | ");
	return notes.length > maxItems ? `${head} | ...(+${notes.length - maxItems} more)` : head;
}

async function summarizeTranscript(
	ctx: ExtensionContext,
	transcript: string,
	options: { log?: boolean } = {},
): Promise<{ summary: string; model: Model<any> } | undefined> {
	const log = options.log !== false;
	const available = await ctx.modelRegistry.getAvailable();
	const preferred = pickTldrModel(available);
	if (!preferred) {
		if (log) notify(ctx, "TL;DR: no configured summary model available; skipping", "warning");
		return undefined;
	}
	const { model, thinkingLevel } = preferred;
	if (log) {
		const thinkingSuffix = thinkingLevel ? `:${thinkingLevel}` : "";
		notify(ctx, `TL;DR: using ${formatModelRef(model)}${thinkingSuffix}`);
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		if (log)
			notify(ctx, `TL;DR: auth unavailable for ${formatModelRef(model)}; skipping`, "warning");
		return undefined;
	}

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: buildTldrPrompt(transcript) }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			reasoningEffort:
				model.reasoning && thinkingLevel && thinkingLevel !== "off" ? thinkingLevel : undefined,
		},
	);

	const parsedSummary = extractSummaryFromResponse(response);
	if (!parsedSummary.summary) {
		const debugParts: string[] = [];
		if (parsedSummary.stopReason) debugParts.push(`stopReason=${parsedSummary.stopReason}`);
		if (parsedSummary.errorMessage) debugParts.push(`error=${parsedSummary.errorMessage}`);
		if (parsedSummary.debug.length > 0) {
			debugParts.push(`parse=${formatDebugNotes(parsedSummary.debug)}`);
		}
		if (log) {
			const suffix = debugParts.length > 0 ? ` (${debugParts.join(" ; ")})` : "";
			notify(ctx, `TL;DR: ${formatModelRef(model)} returned no summary text${suffix}`, "warning");
		}
		return undefined;
	}

	if (log && parsedSummary.debug.length > 0) {
		notify(ctx, `TL;DR: response parse notes: ${formatDebugNotes(parsedSummary.debug)}`, "warning");
	}
	if (log) notify(ctx, "TL;DR ready");
	return { summary: parsedSummary.summary, model };
}

async function generateTldr(ctx: ExtensionContext): Promise<TldrResult | undefined> {
	const transcriptParseNotes: string[] = [];
	const transcript = buildConversationTranscript(ctx.sessionManager.getBranch(), {
		onDebug: (message) => transcriptParseNotes.push(message),
	});
	if (transcriptParseNotes.length > 0) {
		notify(
			ctx,
			`TL;DR: transcript parse notes: ${formatDebugNotes(transcriptParseNotes)}`,
			"warning",
		);
	}
	if (!transcript) {
		throw new Error("No user/assistant text found in the current session.");
	}
	notify(ctx, "TL;DR: extracted session transcript");

	const summaryResult = await summarizeTranscript(ctx, transcript);
	if (!summaryResult) {
		return undefined;
	}

	return { transcript, summary: summaryResult.summary, model: summaryResult.model };
}

async function showTldr(summary: string, model: Model<any>, ctx: ExtensionContext) {
	if (!ctx.hasUI) {
		process.stdout.write(`${summary}\n`);
		return;
	}

	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const mdTheme = getMarkdownTheme();

		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", theme.bold("TL;DR")), 1, 0));
		container.addChild(
			new Text(theme.fg("dim", `using ${formatModelRef(model)} • hidden from agent`), 1, 0),
		);
		container.addChild(new Markdown(summary, 1, 1, mdTheme));
		container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to close"), 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
					done(undefined);
				}
			},
		};
	});
}

async function runDebugFlags(
	ctx: ExtensionContext,
	options: { printTranscript: boolean; printSummary: boolean },
) {
	try {
		const transcriptParseNotes: string[] = [];
		const transcript = buildConversationTranscript(ctx.sessionManager.getBranch(), {
			onDebug: (message) => transcriptParseNotes.push(message),
		});
		if (transcriptParseNotes.length > 0) {
			process.stderr.write(
				`TL;DR transcript parse notes: ${formatDebugNotes(transcriptParseNotes, 6)}\n`,
			);
		}
		if (!transcript) {
			throw new Error("No user/assistant text found in the current session.");
		}

		let summaryResult: { summary: string; model: Model<any> } | undefined;
		if (options.printSummary) {
			summaryResult = await summarizeTranscript(ctx, transcript);
		}

		if (options.printTranscript) {
			process.stdout.write(`# Transcript\n\n${transcript}\n`);
		}
		if (options.printTranscript && options.printSummary) {
			process.stdout.write("\n");
		}
		if (summaryResult) {
			process.stdout.write(
				`# TL;DR (${formatModelRef(summaryResult.model)})\n\n${summaryResult.summary}\n`,
			);
		}
		process.exit(0);
	} catch (error) {
		process.stderr.write(`${getErrorMessage(error)}\n`);
		process.exit(1);
	}
}

export default function tldrExtension(pi: ExtensionAPI) {
	pi.registerFlag("debug-tldr", {
		description: "Print the current session TL;DR and exit",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("debug-tldr-transcript", {
		description: "Print the extracted user/assistant transcript used by /tldr and exit",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("tldr", {
		description: "Generate a user-only summary of the current session",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			notify(ctx, "Generating TL;DR...");

			try {
				const result = await generateTldr(ctx);
				if (!result) return;
				await showTldr(result.summary, result.model, ctx);
			} catch (error) {
				notify(ctx, getErrorMessage(error), "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const printSummary = pi.getFlag("debug-tldr") === true;
		const printTranscript = pi.getFlag("debug-tldr-transcript") === true;
		if (!printSummary && !printTranscript) return;

		await runDebugFlags(ctx, { printTranscript, printSummary });
	});
}

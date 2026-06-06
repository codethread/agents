import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { editMarkdownInExternalEditor } from "./external-editor.js";
import {
	appendResponseSeparator,
	extractResponseAfterSeparator,
	formatAllConversationMessages,
	formatLastAssistantMessage,
} from "./message-format.js";

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

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function openMessageInEditor(
	ctx: ExtensionCommandContext,
	options: { allMessages: boolean },
): Promise<void> {
	await ctx.waitForIdle();

	const branch = ctx.sessionManager.getBranch();
	const body = options.allMessages
		? formatAllConversationMessages(branch)
		: formatLastAssistantMessage(branch);

	if (!body) {
		throw new Error(
			options.allMessages
				? "No user/assistant text found in the current session."
				: "No assistant text found in the current session.",
		);
	}

	const result = await editMarkdownInExternalEditor(appendResponseSeparator(body), {
		fileNameStem: options.allMessages ? "last-message-all" : "last-message",
	});
	if (!result.ok) {
		notify(ctx, result.message, result.level);
		return;
	}

	const response = extractResponseAfterSeparator(result.text);
	if (!response) return;

	if (!ctx.hasUI) {
		process.stdout.write(`${response}\n`);
		return;
	}

	ctx.ui.pasteToEditor(response);
	notify(ctx, "Pasted edited response into the Pi editor");
}

async function runDebugFlag(ctx: ExtensionContext, options: { allMessages: boolean }) {
	const branch = ctx.sessionManager.getBranch();
	const body = options.allMessages
		? formatAllConversationMessages(branch)
		: formatLastAssistantMessage(branch);
	if (!body) {
		throw new Error(
			options.allMessages
				? "No user/assistant text found in the current session."
				: "No assistant text found in the current session.",
		);
	}
	process.stdout.write(`${appendResponseSeparator(body)}\n`);
	process.exit(0);
}

function parseLastMessageArgs(args: string): { allMessages: boolean } {
	const mode = args.trim();
	if (!mode) return { allMessages: false };
	if (mode === "all") return { allMessages: true };
	throw new Error(`Unknown /last-message argument: ${mode}`);
}

export default function lastMessageExtension(pi: ExtensionAPI) {
	pi.registerFlag("debug-last-message", {
		description: "Print the /last-message editor body and exit",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("debug-last-message-all", {
		description: "Print the /last-message all editor body and exit",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("last-message", {
		description: "Open recent messages in $VISUAL/$EDITOR; pass `all` for full transcript",
		getArgumentCompletions: (argumentPrefix) => {
			const prefix = argumentPrefix.trim();
			if ("all".startsWith(prefix)) {
				return [
					{
						value: "all",
						label: "all",
						description: "Open all user/assistant messages",
					},
				];
			}
			return [];
		},
		handler: async (args, ctx) => {
			try {
				await openMessageInEditor(ctx, parseLastMessageArgs(args));
			} catch (error) {
				notify(ctx, getErrorMessage(error), "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			if (pi.getFlag("debug-last-message") === true) {
				await runDebugFlag(ctx, { allMessages: false });
			}
			if (pi.getFlag("debug-last-message-all") === true) {
				await runDebugFlag(ctx, { allMessages: true });
			}
		} catch (error) {
			process.stderr.write(`${getErrorMessage(error)}\n`);
			process.exit(1);
		}
	});
}

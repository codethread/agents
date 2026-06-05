import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
	PROMPT_HISTORY_LIMIT,
	appendPromptHistoryRecord,
	createPromptHistoryRecord,
	getPromptHistoryCachePath,
	loadPromptHistoryRecords,
	type PromptHistoryRecord,
	type PromptHistoryScope,
} from "./history.js";
import {
	resolvePromptHistoryGitContext,
	type PromptHistoryGitContext,
} from "./git.js";

const DEBUG_FLAG = "debug-prompt-history";
const WARNING_OUTSIDE_GIT = "Prompt history is unavailable outside git repositories.";

type RecallScopeName = "repo" | "global";

type RecallState = {
	scope: RecallScopeName;
	cacheKey: string;
	records: PromptHistoryRecord[];
	nextIndex: number;
};

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function notify(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	message: string,
	level: "info" | "warning" | "error" = "info",
) {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}

	const stream = level === "info" ? process.stdout : process.stderr;
	stream.write(`${message}\n`);
}

function shortenHome(filePath: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && filePath.startsWith(home)) return `~${filePath.slice(home.length)}`;
	return filePath;
}

function debugLog(pi: Pick<ExtensionAPI, "getFlag">, ctx: ExtensionContext, message: string) {
	if (pi.getFlag(DEBUG_FLAG) !== true) return;
	notify(ctx, `prompt-history: ${message}`);
}

function extractUserMessageText(message: AgentMessage): string {
	if (message.role !== "user") return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";

	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n\n");
}

function getScopeDescriptor(
	scope: RecallScopeName,
	_repoCwd: string,
	repoRoot: string,
): PromptHistoryScope {
	switch (scope) {
		case "repo":
			return { type: "repo", repoRoot };
		case "global":
			return { type: "global" };
	}
}

function getCacheKey(scope: RecallScopeName, _repoCwd: string, repoRoot: string): string {
	switch (scope) {
		case "repo":
			return repoRoot;
		case "global":
			return "global";
	}
}

export default function promptHistoryExtension(pi: ExtensionAPI) {
	let recallState: RecallState | undefined;
	const gitContextCache = new Map<string, PromptHistoryGitContext | undefined>();

	async function getGitContext(ctx: ExtensionContext) {
		if (gitContextCache.has(ctx.cwd)) return gitContextCache.get(ctx.cwd);

		const gitContext = await resolvePromptHistoryGitContext(pi, ctx.cwd, ctx.signal);
		gitContextCache.set(ctx.cwd, gitContext);
		return gitContext;
	}

	function updateRecallStateWithRecord(record: PromptHistoryRecord) {
		if (!recallState) return;
		if (recallState.scope === "repo" && recallState.cacheKey !== record.repoRoot) return;
		recallState.records = [record, ...recallState.records].slice(0, PROMPT_HISTORY_LIMIT);
		recallState.nextIndex = 0;
	}

	async function recordPrompt(ctx: ExtensionContext, message: AgentMessage) {
		const promptText = extractUserMessageText(message);
		if (!promptText) return;

		const gitContext = await getGitContext(ctx);
		if (!gitContext) {
			debugLog(pi, ctx, `skip append outside git repo cwd=${ctx.cwd}`);
			return;
		}

		const recordInput = {
			message: promptText,
			cwd: gitContext.cwd,
			repoRoot: gitContext.repoRoot,
		};
		const record = createPromptHistoryRecord(recordInput);
		const cachePath = await appendPromptHistoryRecord(record);
		updateRecallStateWithRecord({ ...record, ...recordInput });
		debugLog(
			pi,
			ctx,
			`appended cwd=${gitContext.cwd} repo=${gitContext.repoRoot} cache=${shortenHome(cachePath)}`,
		);
	}

	async function recallPrompt(scope: RecallScopeName, ctx: ExtensionContext) {
		if (!ctx.hasUI) return;

		const gitContext = await getGitContext(ctx);
		if (!gitContext) {
			notify(ctx, WARNING_OUTSIDE_GIT, "warning");
			debugLog(pi, ctx, `recall blocked outside git repo scope=${scope} cwd=${ctx.cwd}`);
			return;
		}

		const cacheKey = getCacheKey(scope, gitContext.cwd, gitContext.repoRoot);
		if (!recallState || recallState.scope !== scope || recallState.cacheKey !== cacheKey) {
			const records = await loadPromptHistoryRecords(
				getScopeDescriptor(scope, gitContext.cwd, gitContext.repoRoot),
			);
			recallState = { scope, cacheKey, records, nextIndex: 0 };
			debugLog(
				pi,
				ctx,
				`loaded scope=${scope} matches=${records.length} cache=${shortenHome(getPromptHistoryCachePath())}`,
			);
		}

		if (recallState.records.length === 0) {
			notify(ctx, `No prompt history found for ${scope} scope.`, "info");
			debugLog(pi, ctx, `no matches for scope=${scope}`);
			return;
		}

		const index = recallState.nextIndex % recallState.records.length;
		const record = recallState.records[index];
		ctx.ui.setEditorText(record.message);
		recallState.nextIndex = (index + 1) % recallState.records.length;
		debugLog(pi, ctx, `selected scope=${scope} index=${index + 1}/${recallState.records.length}`);
	}

	pi.registerFlag(DEBUG_FLAG, {
		description: "Print prompt-history diagnostics while recording and recalling prompts",
		type: "boolean",
		default: false,
	});

	pi.registerShortcut(Key.ctrl("p"), {
		description: "Recall prompt history for the current repository",
		handler: async (ctx) => {
			await recallPrompt("repo", ctx);
		},
	});

	pi.registerShortcut(Key.ctrlShift("p"), {
		description: "Recall prompt history across all repositories",
		handler: async (ctx) => {
			await recallPrompt("global", ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		recallState = undefined;
		gitContextCache.clear();
		if (pi.getFlag(DEBUG_FLAG) !== true) return;

		const gitContext = await getGitContext(ctx);
		if (!gitContext) {
			debugLog(
				pi,
				ctx,
				`cache=${shortenHome(getPromptHistoryCachePath())} cwd=${ctx.cwd} insideGit=false`,
			);
			return;
		}

		debugLog(
			pi,
			ctx,
			`cache=${shortenHome(getPromptHistoryCachePath())} cwd=${gitContext.cwd} repo=${gitContext.repoRoot}`,
		);
	});

	pi.on("message_end", async (event, ctx) => {
		try {
			await recordPrompt(ctx, event.message);
		} catch (error) {
			notify(ctx, `prompt-history: ${getErrorMessage(error)}`, "warning");
		}
	});
}

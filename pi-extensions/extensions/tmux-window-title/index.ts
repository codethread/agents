import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Message, Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	buildWindowTitlePrompt,
	buildWindowTitleSystemPrompt,
	extractFirstUserMessage,
	formatModelRef,
	normalizeWindowTitle,
	parseTmuxWindowId,
	pickWindowTitleModel,
} from "./lib.js";

type TitleState = "idle" | "running" | "done" | "skipped";

type PersistedTitleEntry = {
	data?: {
		title?: string;
		rawTitle?: string;
		model?: string;
	};
};

const TITLE_ENTRY_TYPE = "tmux-window-title";

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

function extractAssistantText(message: Message): string {
	if (message.role !== "assistant") return "";
	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text.trim())
		.filter(Boolean)
		.join("\n")
		.trim();
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

function formatModelFlag(model: Model<any>, thinkingLevel?: string): string {
	const modelRef = formatModelRef(model);
	if (model.reasoning && thinkingLevel) return `${modelRef}:${thinkingLevel}`;
	return modelRef;
}

async function writeSystemPromptToTempFile(): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tmux-window-title-"));
	const filePath = path.join(dir, "system-prompt.md");
	await fs.writeFile(filePath, `${buildWindowTitleSystemPrompt()}\n`, {
		encoding: "utf-8",
		mode: 0o600,
	});
	return { dir, filePath };
}

async function cleanupTempFile(dir: string | null, filePath: string | null) {
	if (filePath) {
		try {
			await fs.unlink(filePath);
		} catch {
			// ignore cleanup failures
		}
	}

	if (dir) {
		try {
			await fs.rm(dir, { recursive: true, force: true });
		} catch {
			// ignore cleanup failures
		}
	}
}

async function runTitleAgent(
	cwd: string,
	firstUserMessage: string,
	model: Model<any>,
	thinkingLevel?: string,
	trackChild?: (proc: ChildProcess | null) => void,
): Promise<{ rawTitle: string; exitCode: number; stderr: string }> {
	let tmpDir: string | null = null;
	let tmpFilePath: string | null = null;

	try {
		const tmp = await writeSystemPromptToTempFile();
		tmpDir = tmp.dir;
		tmpFilePath = tmp.filePath;

		const args = [
			"--mode",
			"json",
			"-p",
			"--no-session",
			"--no-extensions",
			"--model",
			formatModelFlag(model, thinkingLevel),
			"--append-system-prompt",
			tmpFilePath,
			buildWindowTitlePrompt(firstUserMessage),
		];

		const invocation = getPiInvocation(args);

		return await new Promise<{ rawTitle: string; exitCode: number; stderr: string }>((resolve) => {
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			trackChild?.(proc);

			let buffer = "";
			let rawTitle = "";
			let stderr = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					const text = extractAssistantText(event.message as Message);
					if (text) rawTitle = text;
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				trackChild?.(null);
				resolve({ rawTitle, exitCode: code ?? 0, stderr: stderr.trim() });
			});

			proc.on("error", (error) => {
				trackChild?.(null);
				resolve({ rawTitle, exitCode: 1, stderr: getErrorMessage(error) });
			});
		});
	} finally {
		await cleanupTempFile(tmpDir, tmpFilePath);
	}
}

async function captureTmuxWindowId(
	pi: ExtensionAPI,
	_ctx: ExtensionContext,
): Promise<string | undefined> {
	if (!process.env.TMUX?.trim()) return undefined;

	const args = ["display-message", "-p", "-F", "#{window_id}"];
	const paneId = process.env.TMUX_PANE?.trim();
	if (paneId) args.push("-t", paneId);

	const result = await pi.exec("tmux", args, { timeout: 5000 });
	if (result.code !== 0) {
		const message =
			result.stderr.trim() || result.stdout.trim() || `tmux exited with code ${result.code}`;
		throw new Error(message);
	}

	return parseTmuxWindowId(result.stdout);
}

async function applyWindowTitle(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	title: string,
	tmuxWindowId?: string,
): Promise<void> {
	ctx.ui.setTitle(title);
	if (!tmuxWindowId) return;

	const result = await pi.exec("tmux", ["rename-window", "-t", tmuxWindowId, title], {
		timeout: 5000,
	});
	if (result.code !== 0) {
		const message =
			result.stderr.trim() || result.stdout.trim() || `tmux exited with code ${result.code}`;
		throw new Error(message);
	}
}

function getPersistedTitle(ctx: ExtensionContext): string | undefined {
	const entry = ctx.sessionManager
		.getBranch()
		.filter(
			(item: { type: string; customType?: string }) =>
				item.type === "custom" && item.customType === TITLE_ENTRY_TYPE,
		)
		.pop() as PersistedTitleEntry | undefined;

	const title = entry?.data?.title?.trim();
	return title || undefined;
}

export default function tmuxWindowTitleExtension(pi: ExtensionAPI) {
	let state: TitleState = "idle";
	let activeTitle: string | null = null;
	let activeChild: ChildProcess | null = null;
	let tmuxWindowId: string | null = null;

	async function debugLog(ctx: ExtensionContext, message: string) {
		if (pi.getFlag("debug-tmux-title") !== true) return;
		notify(ctx, `tmux-window-title: ${message}`);
	}

	async function generateAndApplyTitle(ctx: ExtensionContext, firstUserMessage: string) {
		const available = await ctx.modelRegistry.getAvailable();
		const preferred = pickWindowTitleModel(available);
		if (!preferred) {
			state = "skipped";
			notify(ctx, "tmux-window-title: no configured small model available; skipping", "warning");
			await debugLog(ctx, "no configured small model available; skipping");
			return;
		}

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(preferred.model);
		if (!auth.ok || !auth.apiKey) {
			state = "skipped";
			notify(
				ctx,
				`tmux-window-title: auth unavailable for ${formatModelRef(preferred.model)}; skipping`,
				"warning",
			);
			await debugLog(ctx, `auth unavailable for ${formatModelRef(preferred.model)}; skipping`);
			return;
		}

		const result = await runTitleAgent(
			ctx.cwd,
			firstUserMessage,
			preferred.model,
			preferred.thinkingLevel,
			(proc) => {
				activeChild = proc;
			},
		);

		if (result.exitCode !== 0) {
			state = "skipped";
			notify(ctx, "tmux-window-title: child pi title generator failed; skipping", "warning");
			await debugLog(
				ctx,
				`child pi failed with exit=${result.exitCode}${result.stderr ? ` stderr=${result.stderr}` : ""}`,
			);
			return;
		}

		const normalizedTitle = normalizeWindowTitle(result.rawTitle, { fallback: "pi" });
		await applyWindowTitle(pi, ctx, normalizedTitle, tmuxWindowId ?? undefined);
		pi.appendEntry(TITLE_ENTRY_TYPE, {
			title: normalizedTitle,
			rawTitle: result.rawTitle,
			model: formatModelFlag(preferred.model, preferred.thinkingLevel),
		});
		activeTitle = normalizedTitle;
		state = "done";
		await debugLog(
			ctx,
			`raw=${JSON.stringify(result.rawTitle)} normalized=${normalizedTitle} model=${formatModelFlag(preferred.model, preferred.thinkingLevel)}`,
		);
	}

	function maybeQueueTitleGeneration(ctx: ExtensionContext) {
		if (state !== "idle" || activeTitle) return;

		const firstUserMessage = extractFirstUserMessage(ctx.sessionManager.getBranch());
		if (!firstUserMessage) return;

		state = "running";
		void generateAndApplyTitle(ctx, firstUserMessage).catch(async (error) => {
			state = "skipped";
			notify(ctx, `tmux-window-title: ${getErrorMessage(error)}`, "warning");
			await debugLog(ctx, `failed: ${getErrorMessage(error)}`);
		});
	}

	pi.registerFlag("debug-tmux-title", {
		description: "Print tmux window-title generation details when the first title is derived",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", async (_event, ctx) => {
		state = "idle";
		activeChild = null;
		tmuxWindowId = null;
		activeTitle = getPersistedTitle(ctx) ?? null;

		try {
			tmuxWindowId = (await captureTmuxWindowId(pi, ctx)) ?? null;
			if (process.env.TMUX?.trim() && !tmuxWindowId) {
				notify(
					ctx,
					"tmux-window-title: could not capture tmux window id; will not rename tmux window",
					"warning",
				);
			}
			if (tmuxWindowId) {
				await debugLog(ctx, `captured tmux window ${tmuxWindowId}`);
			}
		} catch (error) {
			notify(
				ctx,
				`tmux-window-title: failed to capture tmux window id: ${getErrorMessage(error)}`,
				"warning",
			);
			await debugLog(ctx, `tmux window capture failed: ${getErrorMessage(error)}`);
		}

		if (activeTitle) {
			state = "done";
			try {
				await applyWindowTitle(pi, ctx, activeTitle, tmuxWindowId ?? undefined);
				await debugLog(ctx, `restored ${activeTitle}`);
			} catch (error) {
				notify(
					ctx,
					`tmux-window-title: failed to restore title: ${getErrorMessage(error)}`,
					"warning",
				);
				await debugLog(ctx, `restore failed: ${getErrorMessage(error)}`);
			}
			return;
		}

		maybeQueueTitleGeneration(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "user") return;
		maybeQueueTitleGeneration(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (!activeChild || activeChild.killed) return;
		activeChild.kill("SIGTERM");
	});
}

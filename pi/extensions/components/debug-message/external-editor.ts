import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ExternalEditorOpenResult =
	| { ok: true }
	| { ok: false; level: "warning" | "error"; message: string };

type EditorCommand = { command: string; source: "VISUAL" | "EDITOR" };

type OpenExternalEditorOptions = {
	signal?: AbortSignal;
};

function getEditorCommand(): EditorCommand | undefined {
	const visual = process.env.VISUAL?.trim();
	if (visual) return { command: visual, source: "VISUAL" };
	const editor = process.env.EDITOR?.trim();
	if (editor) return { command: editor, source: "EDITOR" };
	return undefined;
}

function terminateEditor(childPid: number): void {
	if (process.platform === "win32") {
		process.kill(childPid, "SIGTERM");
		return;
	}

	process.kill(-childPid, "SIGTERM");
}

function openExternalEditor(
	editor: EditorCommand,
	filePath: string,
	options: OpenExternalEditorOptions,
): Promise<{ ok: true } | { ok: false; message: string; cancelled?: true }> {
	return new Promise((resolve) => {
		const child = spawn(editor.command, [filePath], {
			detached: process.platform !== "win32",
			shell: true,
			stdio: editor.source === "VISUAL" ? "ignore" : "inherit",
		});

		let settled = false;

		function finish(result: { ok: true } | { ok: false; message: string; cancelled?: true }): void {
			if (settled) return;
			settled = true;
			options.signal?.removeEventListener("abort", abort);
			resolve(result);
		}

		function abort(): void {
			if (child.pid === undefined) {
				finish({ ok: false, message: "failed to cancel editor: process id unavailable" });
				return;
			}
			try {
				terminateEditor(child.pid);
			} catch (error) {
				finish({ ok: false, message: `failed to cancel editor: ${getErrorMessage(error)}` });
				return;
			}
			finish({ ok: false, message: "editor cancelled", cancelled: true });
		}

		child.on("error", (error) => {
			finish({ ok: false, message: `failed to start editor: ${error.message}` });
		});

		child.on("exit", (status, signal) => {
			if (status === 0) {
				finish({ ok: true });
				return;
			}
			if (signal) {
				finish({ ok: false, message: `editor terminated by signal ${signal}` });
				return;
			}
			finish({ ok: false, message: `editor exited with status ${status ?? "unknown"}` });
		});

		if (options.signal?.aborted) {
			abort();
			return;
		}
		options.signal?.addEventListener("abort", abort, { once: true });
	});
}

function toMarkdownFileNameStem(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "debug-message";
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function openMarkdownInExternalEditor(
	markdownBody: string,
	options: { fileNameStem?: string; signal?: AbortSignal } = {},
): Promise<ExternalEditorOpenResult> {
	const editor = getEditorCommand();
	if (!editor) {
		return {
			ok: false,
			level: "warning",
			message: "No external editor configured. Set $VISUAL or $EDITOR.",
		};
	}

	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-debug-message-"));
	const fileName = `${toMarkdownFileNameStem(options.fileNameStem ?? "debug-message")}.md`;
	const filePath = path.join(tmpDir, fileName);

	try {
		await fs.writeFile(filePath, markdownBody, "utf-8");
		const result = await openExternalEditor(editor, filePath, { signal: options.signal });
		if (!result.ok) {
			return {
				ok: false,
				level: result.cancelled ? "warning" : "error",
				message: result.message,
			};
		}

		return { ok: true };
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true });
	}
}

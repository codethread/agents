import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ExternalEditorOpenResult =
	| { ok: true }
	| { ok: false; level: "warning" | "error"; message: string };

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
	if (result.signal) {
		return { ok: false, message: `editor terminated by signal ${result.signal}` };
	}

	return { ok: false, message: `editor exited with status ${result.status ?? "unknown"}` };
}

function toMarkdownFileNameStem(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "debug-message";
}

export async function openMarkdownInExternalEditor(
	markdownBody: string,
	options: { fileNameStem?: string } = {},
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
		const result = openExternalEditor(editor, filePath);
		if (!result.ok) {
			return {
				ok: false,
				level: "error",
				message: result.message,
			};
		}

		return { ok: true };
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true });
	}
}

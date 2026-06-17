import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

type EditorCommand = {
	command: string;
	source: "vscode-remote" | "ssh" | "VISUAL" | "EDITOR" | "default";
};

function hasEnv(name: string): boolean {
	return (process.env[name]?.trim() ?? "") !== "";
}

function getEditorCommand(): EditorCommand {
	if (hasEnv("VSCODE_IPC_HOOK_CLI")) return { command: "code --wait", source: "vscode-remote" };
	if (hasEnv("SSH_CONNECTION") || hasEnv("SSH_CLIENT") || hasEnv("SSH_TTY")) {
		return { command: "nvim", source: "ssh" };
	}

	const visual = process.env.VISUAL?.trim();
	if (visual) return { command: visual, source: "VISUAL" };
	const editor = process.env.EDITOR?.trim();
	if (editor) return { command: editor, source: "EDITOR" };
	return { command: "zed --wait", source: "default" };
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function createEditorFile(initialText: string): Promise<{ dir: string; file: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-editor-"));
	const file = path.join(dir, "prompt.md");
	await fs.writeFile(file, initialText, "utf-8");
	return { dir, file };
}

function openEditor(editor: EditorCommand, file: string): ChildProcess {
	return spawn(editor.command, [file], {
		detached: process.platform !== "win32",
		shell: true,
		stdio: "ignore",
	});
}

class NonblockingEditor extends CustomEditor {
	private openFile?: string;
	private openDir?: string;
	private textWhenOpened?: string;

	constructor(...args: ConstructorParameters<typeof CustomEditor>) {
		super(...args);
	}

	private notify(message: string, level: "info" | "warning" | "error" = "info"): void {
		this.onStatus?.(message, level);
	}

	onStatus?: (message: string, level: "info" | "warning" | "error") => void;

	override handleInput(data: string): void {
		if (matchesKey(data, "ctrl+g")) {
			void this.openNonblockingExternalEditor();
			return;
		}

		super.handleInput(data);
	}

	private async openNonblockingExternalEditor(): Promise<void> {
		if (this.openFile) {
			this.notify("External editor is already open", "warning");
			return;
		}

		const editor = getEditorCommand();
		const initialText = this.getExpandedText();
		let dir: string | undefined;
		try {
			const fileInfo = await createEditorFile(initialText);
			dir = fileInfo.dir;
			this.openDir = fileInfo.dir;
			this.openFile = fileInfo.file;
			this.textWhenOpened = initialText;

			const child = openEditor(editor, fileInfo.file);
			child.unref();
			this.notify(`Opened ${editor.source} non-blocking editor`, "info");

			child.on("error", (error) => {
				void this.finishExternalEdit({ error });
			});
			child.on("exit", (status, signal) => {
				void this.finishExternalEdit({ status, signal });
			});
		} catch (error) {
			this.openFile = undefined;
			this.openDir = undefined;
			this.textWhenOpened = undefined;
			if (dir) await fs.rm(dir, { recursive: true, force: true });
			this.notify(`Failed to open external editor: ${getErrorMessage(error)}`, "error");
		}
	}

	private async finishExternalEdit(result: {
		status?: number | null;
		signal?: NodeJS.Signals | null;
		error?: Error;
	}): Promise<void> {
		const file = this.openFile;
		const dir = this.openDir;
		const textWhenOpened = this.textWhenOpened;
		this.openFile = undefined;
		this.openDir = undefined;
		this.textWhenOpened = undefined;

		try {
			if (result.error) {
				this.notify(`External editor failed: ${result.error.message}`, "error");
				return;
			}
			if (result.signal) {
				this.notify(`External editor terminated by signal ${result.signal}`, "warning");
				return;
			}
			if (result.status !== 0) {
				this.notify(`External editor exited with status ${result.status ?? "unknown"}`, "error");
				return;
			}
			if (!file) return;

			const editedText = await fs.readFile(file, "utf-8");
			if (this.getExpandedText() !== textWhenOpened) {
				this.notify(
					"External editor changes not applied because Pi editor text changed",
					"warning",
				);
				return;
			}

			this.setText(editedText);
			this.tui.requestRender();
			this.notify("Applied external editor changes", "info");
		} catch (error) {
			this.notify(`Failed to apply external editor changes: ${getErrorMessage(error)}`, "error");
		} finally {
			if (dir) await fs.rm(dir, { recursive: true, force: true });
		}
	}
}

export default function nonblockingEditorExtension(pi: ExtensionAPI) {
	pi.registerFlag("debug-nonblocking-editor", {
		description: "Print nonblocking editor configuration and exit",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", (_event, ctx) => {
		if (pi.getFlag("debug-nonblocking-editor") === true) {
			const editor = getEditorCommand();
			process.stdout.write(
				JSON.stringify(
					{
						enabled: true,
						binding: "ctrl+g",
						editorCommand: editor.command,
						editorSource: editor.source,
					},
					null,
					2,
				) + "\n",
			);
			process.exit(0);
		}

		if (!ctx.hasUI) return;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new NonblockingEditor(tui, theme, keybindings);
			editor.onStatus = (message, level) => ctx.ui.notify(message, level);
			return editor;
		});
	});
}

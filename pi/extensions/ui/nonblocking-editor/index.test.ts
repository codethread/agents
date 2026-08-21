import { describe, expect, it } from "vitest";
import { getEditorCommand } from "./index.js";

describe("getEditorCommand", () => {
	it("prefers VISUAL over remote-editor heuristics", () => {
		expect(
			getEditorCommand({
				VISUAL: "helix --new-window",
				VSCODE_IPC_HOOK_CLI: "/tmp/vscode-ipc",
				SSH_TTY: "/dev/ttys001",
			}),
		).toEqual({ command: "helix --new-window", source: "VISUAL", usesTerminal: true });
	});

	it("prefers EDITOR over remote-editor heuristics when VISUAL is unset", () => {
		expect(getEditorCommand({ EDITOR: "vim", VSCODE_IPC_HOOK_CLI: "/tmp/vscode-ipc" })).toEqual({
			command: "vim",
			source: "EDITOR",
			usesTerminal: false,
		});
	});

	it.each([
		["VISUAL", "nvim"],
		["EDITOR", "nvim --clean"],
	])("opens local nvim from $%s in the terminal", (variable, command) => {
		expect(getEditorCommand({ [variable]: command })).toMatchObject({
			command,
			source: variable,
			usesTerminal: true,
		});
	});

	it("opens the local default nvim in the terminal", () => {
		expect(getEditorCommand({})).toEqual({
			command: "nvim",
			source: "default",
			usesTerminal: true,
		});
	});
});

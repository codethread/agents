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
});

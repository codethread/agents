# `nonblocking-editor`

Replace Pi's main TUI input editor with a `CustomEditor` that reserves `Ctrl+G` for a non-blocking external editor handoff.

Why this exists:

- Pi's built-in `app.editor.external` waits for `$VISUAL`/`$EDITOR` to exit and blocks the TUI.
- This extension opens `$VISUAL`/`$EDITOR` without awaiting it, so Pi remains usable while the editor window is open.
- The user keybindings should move Pi's built-in external editor action away from `Ctrl+G`, for example:

```json
{
	"app.editor.external": "ctrl+shift+g"
}
```

Behavior:

- `Ctrl+G` lazily chooses an editor when the binding is pressed:
  1. VS Code remote (`$VSCODE_IPC_HOOK_CLI`) -> `code --wait`
  2. SSH (`$SSH_CONNECTION`, `$SSH_CLIENT`, or `$SSH_TTY`) -> `nvim`
  3. `$VISUAL`
  4. `$EDITOR`
  5. local default -> `zed --wait`
- It writes the current prompt to a temporary markdown file and opens the selected editor.
- When the external editor exits successfully, the file content replaces the Pi editor text.
- If the Pi editor text changed while the external editor was open, the external edits are not applied, to avoid clobbering new input.
- `Ctrl+Shift+G` can still be bound to Pi's built-in blocking editor if desired.

Debug flag:

- `--debug-nonblocking-editor` prints the configured editor command and exits.

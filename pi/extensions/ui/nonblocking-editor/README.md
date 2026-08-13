# `nonblocking-editor`

Replace Pi's main TUI input editor with a `CustomEditor` that reserves `Ctrl+G` for a non-blocking external editor handoff.

Why this exists:

- Pi's built-in `app.editor.external` waits for `$VISUAL`/`$EDITOR` to exit and blocks the TUI.
- This extension opens graphical `$VISUAL`/`$EDITOR` commands without awaiting them, so Pi remains usable while the editor window is open.
- The user keybindings should move Pi's built-in external editor action away from `Ctrl+G`, for example:

```json
{
	"app.editor.external": "ctrl+shift+g"
}
```

Behavior:

- `Ctrl+G` lazily chooses an editor when the binding is pressed:
  1. `$VISUAL`
  2. `$EDITOR`
  3. VS Code remote (`$VSCODE_IPC_HOOK_CLI`) -> `code --wait`
  4. SSH (`$SSH_CONNECTION`, `$SSH_CLIENT`, or `$SSH_TTY`) -> `nvim`
  5. local default -> `nvim`

  Explicit editor variables take precedence over remote-environment heuristics.

- It writes the current prompt to a temporary markdown file and opens the selected editor.
- Over SSH, it restores the terminal before starting the editor and resumes Pi after it closes. This lets terminal editors such as `nvim` use the TTY; they cannot be non-blocking in the same terminal.
- When the external editor exits successfully, the file content replaces the Pi editor text.
- If the Pi editor text changed while the external editor was open, the external edits are not applied, to avoid clobbering new input.
- `Ctrl+Shift+G` can still be bound to Pi's built-in blocking editor if desired.

Debug flag:

- `--debug-nonblocking-editor` prints the configured editor command and exits.

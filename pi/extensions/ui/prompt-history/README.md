# `prompt-history`

> Recall previously submitted user prompts across sessions and linked worktrees.

This extension appends submitted user prompts to `${XDG_CACHE_HOME:-~/.cache}/pi/messages.jsonl` when Pi is running inside a git repository. It records both the exact cwd and a canonical repo root so you can recall prompts from the current directory, anywhere in the same repo/worktree family, or globally.

**Shortcuts:**

| Shortcut       | Scope     | Behavior                                          |
| -------------- | --------- | ------------------------------------------------- |
| `Up`           | Exact cwd | Cycle prompts previously submitted from this cwd. |
| `Ctrl+P`       | Repo root | Cycle prompts from the same canonical repo root.  |
| `Ctrl+Shift+P` | Global    | Cycle prompts across all recorded repositories.   |

Recalled prompts are inserted into the editor with `ctx.ui.setEditorText()` and are **not** auto-submitted.

> [!IMPORTANT]
> These shortcuts can conflict with Pi's built-in keybindings. Move model cycling away from `Ctrl+P` / `Ctrl+Shift+P`, and unbind or remap `Up` if it is still attached to cursor movement in `~/.pi/agent/keybindings.json`.

Example override:

```json
{
	"app.model.cycleForward": "ctrl+alt+p",
	"app.model.cycleBackward": "ctrl+shift+alt+p"
}
```

**Debug flag:** `--debug-prompt-history` — prints prompt-history diagnostics while recording and recalling prompts.

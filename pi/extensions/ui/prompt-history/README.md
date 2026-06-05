# `prompt-history`

> Recall previously submitted user prompts across sessions and linked worktrees.

This extension appends submitted user prompts to `${XDG_CACHE_HOME:-~/.cache}/pi/messages.jsonl` when Pi is running inside a git repository. It records both the exact cwd and a canonical repo root so you can recall prompts from anywhere in the same repo/worktree family or globally.

**Prompt recall paths:**

| Shortcut       | Owner                | Scope        | Behavior                                                   |
| -------------- | -------------------- | ------------ | ---------------------------------------------------------- |
| `Up`           | Pi built-in editor   | Current view | Recall/edit the previous prompt from editor input history. |
| `Ctrl+P`       | `prompt-history` ext | Repo root    | Cycle prompts from the same canonical repo root.           |
| `Ctrl+Shift+P` | `prompt-history` ext | Global       | Cycle prompts across all recorded repositories.            |

Recalled prompts are inserted into the editor and are **not** auto-submitted.

> [!IMPORTANT]
> Leave `Up` on Pi's built-in `tui.editor.cursorUp` action, and move every built-in `Ctrl+P` / `Ctrl+Shift+P` binding out of the way in `~/.pi/agent/keybindings.json` so the extension can own those keys without startup warnings.

Required override:

```json
{
	"app.model.cycleForward": "ctrl+alt+p",
	"app.model.cycleBackward": "ctrl+shift+alt+p",
	"app.session.togglePath": "ctrl+alt+o",
	"app.models.toggleProvider": "ctrl+alt+t"
}
```

After editing the file, run `/reload` in Pi.

**Debug flag:** `--debug-prompt-history` — prints prompt-history diagnostics while recording and recalling prompts.

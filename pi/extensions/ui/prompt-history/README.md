# `prompt-history`

> Recall previously submitted user prompts across sessions and linked worktrees.

This extension appends submitted user prompts to `${XDG_CACHE_HOME:-~/.cache}/pi/messages.jsonl` when Pi is running interactively (`ctx.hasUI`) inside a git repository. Headless runs such as `--print` or subagent sessions are not recorded. It records both the exact cwd and a canonical repo root so you can recall prompts from anywhere in the same repo/worktree family or globally.

**Prompt recall paths:**

| Shortcut       | Owner                | Scope        | Behavior                                                                    |
| -------------- | -------------------- | ------------ | --------------------------------------------------------------------------- |
| `Up`           | Pi built-in editor   | Current view | Recall/edit the previous prompt from editor input history.                  |
| `Ctrl+P`       | `prompt-history` ext | Repo root    | Cycle prompts from the same canonical repo root.                            |
| `Ctrl+Shift+P` | `prompt-history` ext | Global       | Cycle prompts across all recorded repositories.                             |
| `Ctrl+R`       | `prompt-history` ext | Repo root    | Fuzzy-pick a prompt in an `fzf-tmux` popup; `Tab`/`Shift+Tab` cycle scopes. |

Recalled prompts are inserted into the editor and are **not** auto-submitted.

## Fuzzy picker (`Ctrl+R`)

`Ctrl+R` streams the history file through `jq` into `fzf-tmux`, so fuzzy
matching and rendering stay in `fzf` rather than TypeScript. The picker needs:

- `tmux` (fzf opens a popup over the current pane; tmux 3.2+ for popups)
- `fzf` and `fzf-tmux` on `PATH`
- `jq` on `PATH`

Outside tmux, Pi shows a warning instead of opening the picker. The popup
shows local time, cwd basename, and a one-line prompt preview; `Enter` replaces
the editor text with the selected prompt, `Esc` cancels. `Tab` cycles the
listing scope in place — repo root → exact cwd → global — and `Shift+Tab`
cycles it in reverse, keeping the popup open and the typed query intact; the
header always names the current scope and both Tab targets.

> [!IMPORTANT]
> Leave `Up` on Pi's built-in `tui.editor.cursorUp` action, and move every built-in `Ctrl+P` / `Ctrl+Shift+P` binding out of the way in `~/.pi/agent/keybindings.json` so the extension can own those keys without startup warnings. Reserved bindings are skipped entirely; the `Ctrl+R` binding only needs `app.session.rename` moved to avoid a startup diagnostic.

Required override:

```json
{
	"app.model.cycleForward": "ctrl+alt+p",
	"app.model.cycleBackward": "ctrl+shift+alt+p",
	"app.session.togglePath": "ctrl+alt+o",
	"app.models.toggleProvider": "ctrl+alt+t",
	"app.session.rename": "ctrl+alt+r"
}
```

After editing the file, run `/reload` in Pi.

**Debug flag:** `--debug-prompt-history` — prints prompt-history diagnostics while recording and recalling prompts.

# `tmux-window-title`

> Name the Rex tab or tmux window from the first user message and mark settled agents.

After the session’s first user message, this extension spawns a small child `pi` process to generate a terse 1–4 word request label, converts it to kebab-case, and applies it to the terminal:

- **Rex:** renames the **tab**, not the session or pane. Requires the `rex` CLI and the `REX_SESSION` / `REX_BLOCK` environment variables supplied by Rex. The containing tab is captured at session start, so switching tabs while generation runs does not redirect the rename.
- **tmux:** renames the window captured at session start. When tmux runs inside Rex, only the tmux window is renamed.
- **Other terminals:** updates the client title bar via `ctx.ui.setTitle()`.

The label is persisted in Pi session state and reapplied on reload/resume. It summarizes the first request, not the agent’s current activity. If terminal target capture fails, a warning is shown and no Rex tab or tmux window is explicitly renamed.

When the agent fully settles, the title gains a `●` prefix, e.g. `● fix-tests`, to flag sessions ready for attention. This uses `agent_settled`: retries, compaction, and queued continuations finish first. The marker means the agent stopped, not necessarily that the task succeeded. Pi’s native [Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status) reporting supplies Rex’s working/done indicators independently; this extension does not emit duplicate status reports.

The marker clears on the next agent run or session shutdown. Only the label persists; reload/resume restores it without a marker. While generation is pending or unavailable, the marker uses `● pi`; a late-generated label preserves the current status. The terminal title bar gets the same marker.

**Debug flag:** `--debug-tmux-title` — prints the captured terminal target, generation, restoration, and settled-marker updates for both Rex and tmux.

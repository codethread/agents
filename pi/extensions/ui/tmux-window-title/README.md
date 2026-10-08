# `tmux-window-title`

> Name the tmux window from the first user message and mark settled agents.

After the session’s first user message, this extension spawns a small child `pi` process to generate a terse 1–4 word request label, converts it to kebab-case, and renames the tmux window captured at session start—even if you switch windows before generation finishes. The label is persisted in session state and reapplied on reload/resume. Outside tmux, `ctx.ui.setTitle()` updates the client title bar instead.

When the agent fully settles, the title gains a `●` prefix, e.g. `● fix-tests`, to flag sessions ready for attention. This uses `agent_settled`: retries, compaction, and queued continuations finish first. The marker means the agent stopped, not necessarily that the task succeeded.

The marker clears on the next agent run or session shutdown. Only the label persists; reload/resume restores it without a marker. While generation is pending or unavailable, the marker uses `● pi`; a late-generated label preserves the current status. The terminal title bar gets the same marker outside tmux.

**Debug flag:** `--debug-tmux-title` — prints generation, restoration, and settled-marker updates.

# `tmux-window-title`

> Set the current tmux window title from the first user message.

After the first user message in a session, this extension spawns a small child `pi` process, asks it for a terse 1-4 word label for the request, kebab-cases the result, and renames the tmux window captured at session start. This avoids retargeting the wrong window if you switch tmux windows before the child model returns. The derived title is persisted in session state and reapplied on reload/resume. When Pi is not running inside tmux, it still updates the client title bar via `ctx.ui.setTitle()`.

**Debug flag:** `--debug-tmux-title` — prints generation details when the title is derived or restored.

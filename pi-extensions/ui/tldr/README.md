# `tldr`

> Generate a catch-up summary of the current session.

Use `/tldr` when returning to a session and needing a quick recap. It reads the conversation, strips tool calls and thinking blocks, sends the transcript to a small model, and shows the summary in the shared hidden debug-message UI. The summary is **not** added to the agent's context unless you explicitly send it.

In the UI:

- `Ctrl+G` opens the summary markdown in your external editor for easier reading.
- `Ctrl+Enter` sends the summary markdown to the agent as a user message.
- `Enter` or `Esc` closes the panel.

**Command:** `/tldr`

**Debug flags:**

| Flag                      | Description                             |
| ------------------------- | --------------------------------------- |
| `--debug-tldr`            | Print the generated summary and exit    |
| `--debug-tldr-transcript` | Print the extracted transcript and exit |

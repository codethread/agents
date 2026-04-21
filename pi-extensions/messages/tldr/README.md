# `tldr`

> Generate a catch-up summary of the current session.

Use `/tldr` when returning to a session and needing a quick recap. It reads the conversation, strips tool calls and thinking blocks, sends the transcript to a small model, and shows the summary in transient UI. The summary is **not** added to the agent's context.

**Command:** `/tldr`

**Debug flags:**

| Flag                      | Description                             |
| ------------------------- | --------------------------------------- |
| `--debug-tldr`            | Print the generated summary and exit    |
| `--debug-tldr-transcript` | Print the extracted transcript and exit |

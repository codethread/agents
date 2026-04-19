# `etiquette`

> Compact a drafted user-facing message and return the exact text to send.

This extension registers a custom `etiquette` tool. The tool accepts a `message` string and returns a compacted version suitable for sending to the user verbatim. Its tool description tells the agent to use it immediately before yielding a user-facing reply, then send the returned text and stop. Messages of 50 lines or fewer are returned unchanged without invoking the child compaction run.

The tool is only exposed for the main agent and only on non-Opus models.

In the Pi UI, the tool row shows the compacted message by default. Expand the row with `Ctrl+o` to inspect the original draft for debugging.

Internally it runs an isolated child Pi process in print mode with session persistence disabled, using its own explicit system prompt override and explicit model selection, then uses the printed output as the tool result.

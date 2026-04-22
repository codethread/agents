# `questionnaire`

> Structured question forms opened in your external editor.

The agent uses this tool automatically whenever it needs your input — clarification, choices, or confirmation. You don't need to ask for it; it's the agent's primary way of communicating back to you.

When invoked, a temporary `.md` file opens in `$VISUAL` (fallback `$EDITOR`) alongside a companion `session-tldr.md` transcript file referenced by a first-line HTML comment (`<!-- session-summary: /abs/path -->`). Each question renders rich option details separately from a compact `<user-response>` block. You answer by checking exactly one option; if you choose `Other:`, you write freeform text directly below that line.

If you leave invalid or missing answers, the form reopens with validation feedback and instructions. Saving an empty questionnaire buffer is treated as an explicit stop.

In headless subagent runs, Pi sets `PI_SUBAGENT=1` and the questionnaire extension removes itself from the active tool list at session start, so the tool stays hidden before the prompt is built.

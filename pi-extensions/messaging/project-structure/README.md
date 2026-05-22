# `project-structure`

> Send a bounded repository tree snapshot to the model as a custom first-turn message.

> [!NOTE]
> This is a messaging extension, not a system-prompt extension: the tree is model-visible as a custom message but kept out of the effective system prompt.

At session start, this extension finds the current repo root, counts visible files with `fd -t f`, and when needed counts folders with `fd -t d`, then picks the widest `tree` view that stays within a 200-line budget. The final snapshot is wrapped in `<system-reminder type="project-structure">...</system-reminder>` and sent through Pi's custom-message channel during `before_agent_start`, not appended to the system prompt:

- fewer than 200 files: full `tree`
- otherwise try `tree -L 3`
- if that is still over 200 lines, fall back to `-L 2`, then `-L 1`
- when the full tree is not shown, add a compact note with total file/folder counts
- if even `-L 1` is still over budget, truncate that preview to the first 200 lines and say so

The computed block is cached per session and invalidated after `bash` and `write` tool executions so later turns can refresh after structural changes.

In the TUI, the custom renderer shows only `Project tree sent to agent`; the tree itself is still sent to the model but is not rendered in the chat transcript.

Inspect system-prompt sections through the `system-prompt` extension's `--debug-prompt` flag or `/debug-prompt` command. The project structure is not part of that debug prompt because it is sent as a custom message.

> [!NOTE]
> `charset=ascii` is used as it's more token efficient that the pretty charset

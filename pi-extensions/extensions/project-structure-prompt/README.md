# `project-structure-prompt`

> Append a bounded repository tree snapshot to the system prompt.

At session start, this extension finds the current repo root, counts visible files with `fd -t f`, and when needed counts folders with `fd -t d`, then picks the widest `tree` view that stays within a 200-line budget. The final snapshot is wrapped in `<system_reminder type="project-structure">...</system_reminder>` so it stays isolated from neighboring prompt sections:

- fewer than 200 files: full `tree`
- otherwise try `tree -L 3`
- if that is still over 200 lines, fall back to `-L 2`, then `-L 1`
- when the full tree is not shown, add a compact note with total file/folder counts
- if even `-L 1` is still over budget, truncate that preview to the first 200 lines and say so

The computed block is cached per session and invalidated after `bash` and `write` tool executions so later turns can refresh after structural changes.

**Debug flag:** `--debug-project-structure` — print the computed prompt block and exit.

> [!NOTE]
> `charset=ascii` is used as it's more token efficient that the pretty charset

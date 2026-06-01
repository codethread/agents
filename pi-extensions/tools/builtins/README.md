# Built-in tool renderers

> Small plugin that replaces Pi built-in tool presentation without changing tool behavior.

## `read`

Compact file read display. File contents are hidden in the TUI (only the path is shown). Errors display simplified messages.

## `bash`

Compact shell output display. Output is collapsed to 5 lines by default; press `Ctrl+o` to expand. Truncation notices are shown when output was clipped.

## `write`

Compact file write display. Shows the destination path, streamed line count, and first line preview. Existing destination paths are highlighted with warning styling.

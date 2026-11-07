# `statusline`

> Persistent status bar — transparent to the user.

Renders a responsive footer at the bottom of the TUI, independently of any avatar or emote widget. The footer is installed at startup and on session changes, and refreshes when the git branch changes. Non-interactive modes do not install it.

At widths of 100 columns or more, core details use two balanced rows when the path and model fit together:

```text
~/project (main)                                    model • high (provider sub L)
14k/128k [14:32] $0.000                                              session-id
```

Otherwise, core details stack into three rows; the session stays bottom-right whenever it fits beside the stats:

```text
~/project (main)
model • high (provider sub L)
14k/128k [14:32] $0.000                         session-id
```

The stats row shows current/max context tokens, the latest cache-hit timestamp when available, and cumulative session cost. Context usage is warning-colored above 70% and error-colored above 90%. Extension statuses appear on separate rows; all rows are truncated to the terminal width.

The bottom-right label shows the Botlake agent identity from `BL_ACTOR` prefixed with `bl: ` when available (for example, `bl: jade-rich-guan`), otherwise the session ID. A session name, when set, is preserved with the identity or ID in parentheses. No Botlake CLI lookup is required.

Inside the provider parentheses, `sub` indicates subscription authentication and `L` indicates `PI_CACHE_RETENTION=long`.

## Implementation

`index.ts` owns the responsive renderer and footer lifecycle. `usage-format.ts` contains formatting helpers also used by subagent output.

## Debug

Run Pi with `--debug-statusline` to append the selected layout, available width, and row count to the footer.

# `statusline`

> Persistent status bar — transparent to the user.

Renders a responsive footer at the bottom of the TUI, independently of any avatar or emote widget. The footer is installed at startup and on session changes, and refreshes when the git branch changes. Non-interactive modes do not install it.

At widths of 100 columns or more, core details use two balanced rows when the path, available identities, and model fit together:

```text
~/project (main)    millstrand-name    scent-name    model • high (provider sub L)
14k/128k [14:32] $0.000                              session-id
```

Otherwise, core details stack into three rows without identities, four with one, or five with both. Each available identity gets its own row between the path and model; the session stays bottom-right whenever it fits beside the stats:

```text
~/project (main)
millstrand-name
scent-name
model • high (provider sub L)
14k/128k [14:32] $0.000                         session-id
```

The stats row shows current/max context tokens, the latest cache-hit timestamp when available, and cumulative session cost. Context usage is warning-colored above 70% and error-colored above 90%. Other extension statuses appear on separate rows; all rows are truncated to the terminal width.

Inside the provider parentheses, `sub` indicates subscription authentication and `L` indicates `PI_CACHE_RETENTION=long`.

The prompt extension supplies Millstrand identity through Pi's `millstrand-identity` status key; Hive's Scent extension supplies Hive identity through `scent-identity`. Both are optional and appear independently in the accent color between path and model. The statusline reads only these Pi statuses for identity and excludes their keys from the other extension status rows.

## Implementation

`index.ts` owns the responsive renderer and footer lifecycle. `usage-format.ts` contains formatting helpers also used by subagent output.

## Debug

Run Pi with `--debug-statusline` to append the selected layout, available width, and row count to the footer.

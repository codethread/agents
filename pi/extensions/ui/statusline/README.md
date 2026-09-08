# `statusline`

> Persistent status bar — transparent to the user.

Renders a responsive footer at the bottom of the TUI.

At widths of 100 columns or more, core details use two balanced rows:

```text
~/project (main)        agent-name        model • high (provider sub L)
14k/128k [14:32] $0.000                              session-id
```

Narrow views use four compact rows. The model moves above the stats row, and the session stays bottom-right whenever it fits beside the stats:

```text
~/project (main)
agent-name
model • high (provider sub L)
14k/128k [14:32] $0.000                         session-id
```

The stats row shows current/max context tokens, the latest cache-hit timestamp when available, and cumulative session cost. Context usage is warning-colored above 70% and error-colored above 90%.

Inside the provider parentheses, `sub` indicates subscription authentication and `L` indicates `PI_CACHE_RETENTION=long`.

Working directory, git branch, session name/ID, agent identity (`MILLSTRAND_AGENT_ID`), active model, and provider are shown according to available width.

## Debug

Run Pi with `--debug-statusline` to append the selected layout, available width, and row count to the footer.

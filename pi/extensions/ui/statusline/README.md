# `statusline`

> Persistent status bar — transparent to the user.

Renders a responsive footer at the bottom of the TUI, independently of any avatar or emote widget. The footer is installed at startup and on session changes, and refreshes when the git branch changes. Non-interactive modes do not install it.

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

The stats row shows current/max context tokens, the latest cache-hit timestamp when available, and cumulative session cost. Context usage is warning-colored above 70% and error-colored above 90%. Other extension statuses appear on separate rows; all rows are truncated to the terminal width.

Inside the provider parentheses, `sub` indicates subscription authentication and `L` indicates `PI_CACHE_RETENTION=long`.

Working directory, git branch, session name/ID, Millstrand identity, active model, and provider are shown according to available width. The prompt extension publishes the native identity under Pi's `millstrand-identity` status key. The statusline displays it once beside the model, without an environment fallback or custom identity event consumer.

## Debug

Run Pi with `--debug-statusline` to append the selected layout, available width, and row count to the footer.

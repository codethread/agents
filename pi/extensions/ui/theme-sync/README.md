# `theme-sync`

> Keeps Pi synced to the shared light/dark theme sentinel.

## Behavior

- reads `$XDG_STATE_HOME/color-theme` (or `~/.local/state/color-theme`)
- selects `rose-pine` as the base Pi theme on startup
- applies `rose-pine-dawn` when the sentinel says `light`
- applies `rose-pine-moon` when the sentinel says `dark`
- keeps the active runtime theme name as `rose-pine`
- watches the sentinel directory and reapplies the matching palette on change

If the sentinel is missing or invalid, the extension skips sync and leaves the current theme alone.

## Manual test

1. `/reload` or restart Pi so the extension loads.
2. Write `light` or `dark` into the sentinel file.
3. Confirm the Pi UI flips between the Dawn and Moon palettes.

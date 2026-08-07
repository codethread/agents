# `theme-sync`

> Keeps Pi synced to the shared light/dark theme sentinel.

## Behavior

- reads `$XDG_STATE_HOME/color-theme` (or `~/.local/state/color-theme`)
- selects the stable `rose-pine` setting on startup
- applies the Dawn palette when the sentinel says `light`
- applies the Moon palette when the sentinel says `dark`
- swaps palettes in memory, so `settings.json` remains `"theme": "rose-pine"`
- watches the sentinel directory and reapplies the matching palette on change

If the sentinel is missing or invalid, the extension skips sync and leaves the current theme alone.

## Manual test

1. `/reload` or restart Pi so the extension loads.
2. Write `light` or `dark` into the sentinel file.
3. Confirm the Pi UI flips between the Dawn and Moon palettes.

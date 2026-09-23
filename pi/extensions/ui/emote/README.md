# `emote`

Vendored from `pi-emote` and adapted for this package layout.

Animated avatar widget above the editor. It reacts to session state: startup, idle, thinking, talking, read/write/tool calls, failures, and compaction.

The avatar is **hidden at the start of every session** — the same state `/emote off` leaves it in. The status rows the widget renders (path, model, context/cost, session) stay visible; run `/emote` to toggle the avatar on for the current session.

## Local defaults

This package assumes Kitty:

- direct Kitty: `kitty`
- tmux in Kitty: `kitty-unicode`

The widget always renders the session/model footer details. Kitty image drawing only happens while the avatar is shown, so nothing is drawn until you run `/emote on`.

Use `/emote` to toggle the avatar for the current session without restarting Pi.

Avatar size can be a number or a responsive width map:

```json
{
	"size": {
		"0": null,
		"40": 6,
		"70": 8
	}
}
```

For width maps, the greatest key `<=` terminal width wins. `null` hides the avatar and keeps the status rows.

Config defaults live in [`config.json`](./config.json). Override globally or per project:

- `~/.pi/agent/extensions/pi-emote/config.json`
- `.pi/extensions/pi-emote/config.json`

Text beside the avatar uses the responsive [`statusline`](../statusline/README.md) rows. Additional extension statuses are laid out as flex items; when the avatar has fewer rows than items, bottom items move upward and share a line with whitespace between them. If a shared line is too narrow, items are truncated with `textEllipsis` (default `$`; set it to `...`, a Nerd Font glyph, etc.).

## Debug

Run Pi with `--debug-emote` or set `"debug": true` in config. Logs are written to `pi/extensions/ui/emote/debug.log`.

## Emote sets

Bundled sets:

- `default`
- `red`
- `aza_choi`

Use `--emote <name>` to choose a pack for the session, overriding model-to-set mapping:

```sh
pi --emote red
```

Model-to-set mapping uses glob patterns in config when `--emote` is not provided:

```json
{
	"emotes": [{ "model": "*", "emote-set": "default" }]
}
```

Custom sets can be placed at `.pi/extensions/pi-emote/emotes/<name>/` or `~/.pi/agent/extensions/pi-emote/emotes/<name>/`.

## `/emote [toggle|on|off|status]`

Toggles a session-local avatar visibility override. The avatar starts hidden each session.

- `toggle` or no argument: flip the current effective visibility
- `on`: show the avatar for this session, drawing images even over SSH
- `off`: hide the avatar for this session
- `status`: show the current mode and effective renderer state

This override is not persisted; restarting or reloading the session starts hidden again.

## License

Original pi-emote code/assets are MIT licensed. See [`LICENSE.pi-emote`](./LICENSE.pi-emote).

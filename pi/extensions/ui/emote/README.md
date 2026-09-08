# `emote`

Vendored from `pi-emote` and adapted for this package layout.

Animated avatar widget above the editor. It reacts to session state: startup, idle, thinking, talking, read/write/tool calls, failures, and compaction.

## Local defaults

This package assumes Kitty:

- direct Kitty: `kitty`
- tmux in Kitty: `kitty-unicode`

When Pi is running inside an SSH connection (`SSH_CONNECTION`, `SSH_CLIENT`, or `SSH_TTY` is set), image drawing is disabled so the extension does not try to draw remote Kitty images. The widget still renders the session/model footer details by default.

Use `/emote on` to force emotes back on for the current session, or `/emote off` to hide them again without restarting Pi.

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

For width maps, the greatest key `<=` terminal width wins. `null` hides the widget.

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

Toggles a session-local emote visibility override.

- `toggle` or no argument: flip the current effective visibility
- `on`: force emotes on for this session, even when SSH auto-detection would normally hide them
- `off`: hide emotes for this session
- `status`: show the current mode and effective renderer state

This override is not persisted; restarting or reloading the session returns to normal auto-detection.

## License

Original pi-emote code/assets are MIT licensed. See [`LICENSE.pi-emote`](./LICENSE.pi-emote).

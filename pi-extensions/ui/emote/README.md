# `emote`

Vendored from `pi-emote` and adapted for this package layout.

Animated avatar widget above the editor. It reacts to session state: startup, idle, thinking, talking, read/write/tool calls, failures, and compaction.

## Local defaults

This package assumes Kitty:

- direct Kitty: `kitty`
- tmux in Kitty: `kitty-unicode`

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

## Debug

Run Pi with `--debug-emote` or set `"debug": true` in config. Logs are written to `pi-extensions/ui/emote/debug.log`.

## Emote sets

Bundled set:

- `default`

Model-to-set mapping uses glob patterns in config:

```json
{
	"emotes": [{ "model": "*", "emote-set": "default" }]
}
```

Custom sets can be placed at `.pi/extensions/pi-emote/emotes/<name>/` or `~/.pi/agent/extensions/pi-emote/emotes/<name>/`.

## License

Original pi-emote code/assets are MIT licensed. See [`LICENSE.pi-emote`](./LICENSE.pi-emote).

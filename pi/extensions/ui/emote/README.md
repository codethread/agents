# `emote`

Vendored from `pi-emote` and adapted for this package layout.

Animated avatar widget above the editor. It reacts to session state: startup, idle, thinking, talking, read/write/tool calls, failures, and compaction.

## Local defaults

This package assumes Kitty:

- direct Kitty: `kitty`
- tmux in Kitty: `kitty-unicode`

When Pi is running inside an SSH connection (`SSH_CONNECTION`, `SSH_CLIENT`, or `SSH_TTY` is set), image drawing is disabled so the extension does not try to draw remote Kitty images. The widget still renders the session/model footer details.

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

Text beside the avatar is laid out as flex items. Each item starts on its own line; when the avatar has fewer rows than items, bottom items move upward and share a line with whitespace between them. If a shared line is too narrow, items are truncated with `textEllipsis` (default `$`; set it to `...`, a Nerd Font glyph, etc.).

## Debug

Run Pi with `--debug-emote` or set `"debug": true` in config. Logs are written to `pi/extensions/ui/emote/debug.log`.

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

## `/emote-gen-prompt <guidance>`

Sends the current model a prompt-template task for generating temporary image-generation prompt files matching the bundled emote style. The guidance changes the character design while preserving the 128x128 retro handheld pixel-art constraints.

Example:

```text
/emote-gen-prompt a pikachu-like creature with large expressive eyes and green skin
```

The model is instructed to write markdown prompts under `tmp/emote-gen/default/` for every bundled frame and list the created prompt files. It does not generate images directly.

## License

Original pi-emote code/assets are MIT licensed. See [`LICENSE.pi-emote`](./LICENSE.pi-emote).

# Last message

Open session text in your external editor for comfortable reading and response drafting.

Commands:

- `/last-message` opens the most recent assistant text message.
- `/last-message all` opens all user and assistant text messages, separated with `---`.

Debug flags:

- `--debug-last-message` prints the `/last-message` editor body and exits.
- `--debug-last-message-all` prints the `/last-message all` editor body and exits.

The temporary markdown file ends with:

```html
<!-- pi-last-message-response-below -->
```

Anything written after that separator and saved before closing `$VISUAL`/`$EDITOR` is pasted back into Pi's input editor. Tool calls, tool results, thinking blocks, and images are omitted.

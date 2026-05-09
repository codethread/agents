# `interactive-shell`

> Spawn and control interactive shell panes.

Provides the `interactive_shell` tool for persistent PTYs: TUIs, REPLs, dev servers, watch processes, or any shell that needs later input/output inspection.

## Tool actions

```json
{ "action": "spawn" }
```

Starts a new empty shell pane using the shell already provided by the environment. The first spawned shell opens beside Pi; later shells stack below the latest live shell. Returns a `shellId`/pane id plus the `$SHELL` value.

```json
{ "action": "send", "shellId": "%12", "text": "npm run dev", "submit": true }
```

Types literal text into the shell. Multiline text is pasted into the shell. `submit: true` presses Enter after the text; it can also be used by itself.

```json
{ "action": "tail", "shellId": "%12", "lines": 100 }
```

Captures recent output. `lines` defaults to 100.

```json
{ "action": "list" }
```

Lists live shells created by this tool with their ids and shell info.

```json
{ "action": "kill", "shellId": "%12" }
```

Stops one shell. If `shellId` is omitted for `send`, `tail`, or `kill`, the latest live shell is used.

## Debug flag

```sh
pi --debug-interactive-shell 'printf READY; sleep 1' -p ping
```

Runs the same spawn → send → tail → kill path directly and prints JSON, without waiting for an agent tool call.

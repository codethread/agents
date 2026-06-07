# `interactive-shell`

> Spawn and control interactive shell tmux sessions.

Provides the `interactive_shell` tool for persistent PTYs: TUIs, REPLs, dev servers, watch processes, or any shell that needs later input/output inspection. Each spawned shell runs in its own detached tmux session.

## Tool actions

```json
{ "action": "spawn", "name": "dev server" }
```

Starts a new empty shell in a detached tmux session using the shell already provided by the environment. `name` is optional, must be 80 characters or fewer, and is shown in `/shells` and `list`. Returns a `shellId`/pane id, the friendly name, the tmux session name, and the `$SHELL` value.

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

## Slash command

```text
/shells
```

Opens a fuzzy picker of active shells created by this Pi session, showing each shell's friendly name, pane id, and cwd. Selecting a shell switches the current tmux client to that shell's tmux session.

## Debug flag

```sh
pi --debug-interactive-shell 'printf READY; sleep 1' -p ping
```

Runs the same spawn → send → tail → kill path directly and prints JSON, without waiting for an agent tool call.

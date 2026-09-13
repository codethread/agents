# `interactive-shell`

> Spawn and control interactive shell tmux sessions.

Provides the `interactive_shell` tool for persistent PTYs: TUIs, REPLs, dev servers, watch processes, or any shell that needs later input/output inspection. Each spawned shell runs in its own detached tmux session.

## Tool actions

```json
{
	"action": "spawn",
	"name": "dev server",
	"shell": "bash",
	"persist": true
}
```

Starts a new empty shell in a detached tmux session. `shell` accepts `user`, `bash`, or `zsh` and defaults to `user`, which uses `$SHELL` with the user's normal configuration. The focused `bash` and `zsh` choices start without user configuration (`bash --noprofile --norc` and `zsh -f`).

`persist` defaults to `false`. Session-scoped shells survive between replies and are stopped on `session_shutdown`: when Pi exits, or when the session's extension runtime is replaced by a session switch or reload. Interrupting a response without exiting Pi does not stop them. Set `persist: true` to keep a shell running after shutdown. Persistent tmux sessions outlive Pi's in-memory registry, so after Pi exits or reloads they must be managed with tmux directly.

`name` is optional, must be 80 characters or fewer, and is shown in `/shells` and `list`. The tmux session is named `pi--<name>`, with the name normalized to a lowercase tmux-safe slug. Spawn fails if that tmux session is already active, so choose a unique name or stop the existing session first. Spawn returns the `shellId`/pane id, friendly name, tmux session name, selected shell, and persistence state.

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

Lists live shells created by this extension instance with their ids, shell choice, and persistence state.

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

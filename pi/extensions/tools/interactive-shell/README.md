# `interactive-shell`

> Spawn and control tmux shells private to each agent; use `persist: true` to share with the user.

Provides the `interactive_shell` tool for TUIs, REPLs, and terminal work that needs later input/output inspection. Each shell runs in its own detached tmux session.

## Visibility and lifetime

- **Default (`persist: false`):** each extension runtime gets its own private tmux server. Shells survive between replies but are not on the user's server. Do not expect the user or other agents to see them.
- **`persist: true`:** uses the user's shared `default` tmux server explicitly, regardless of the server hosting Pi. These shells remain after Pi exits; the caller must clean them up.

Private servers are created lazily, without loading tmux configuration. Shell startup configuration still follows the `shell` option below. Concurrent agents, including runtimes within one Pies process, have separate servers and can reuse session names.

On `session_shutdown` (exit, session switch, or reload), the extension stops its entire private server and removes its socket and temporary directory. A detached supervisor watches the agent's IPC connection and performs the same cleanup after an abrupt process exit, including `SIGTERM` and `SIGKILL`. Cleanup does not depend on an in-process exit hook or polling a PID. Private commands cannot restart a server during teardown. Interrupting a response without exiting Pi leaves its shells running.

The supervisor owns only the private server and its `/tmp/pi-shell-*` directory; it never stops the shared `default` server. Cleanup is not guaranteed if the supervisor itself is forcibly killed or the machine loses power. Persistent sessions outlive Pi's in-memory registry and must be managed with tmux directly after exit or reload.

## Tool actions

```json
{ "action": "spawn", "name": "repl", "shell": "bash" }
```

Starts an empty shell on the agent's private server. Set `persist: true` when the user needs access or the shell must outlive the agent.

`shell` accepts `user`, `bash`, or `zsh` and defaults to `user`, which uses `$SHELL` with the user's normal configuration. The focused `bash` and `zsh` choices start without user configuration (`bash --noprofile --norc` and `zsh -f`).

`name` is optional, must be 80 characters or fewer, and appears in `list` (and `/shells` for persistent shells). The tmux session is named `pi--<name>`, normalized to a lowercase tmux-safe slug. Spawn fails if that name is already active on the selected server. Spawn returns an opaque shell id, pane id, server (`default` or a private socket path), session name, shell choice, and persistence state. Use the opaque shell id for subsequent tool calls; tmux pane ids can collide across servers.

```json
{ "action": "send", "shellId": "shell-1", "text": "python3", "submit": true }
```

Types literal text into the shell. Multiline text is pasted. `submit: true` presses Enter after the text; it can also be used by itself.

```json
{ "action": "tail", "shellId": "shell-1", "lines": 100 }
```

Captures recent output. `lines` defaults to 100.

```json
{ "action": "list" }
```

Lists live shells created by this extension instance, both private and persistent.

```json
{ "action": "kill", "shellId": "shell-1" }
```

Stops one shell on its owning server. If `shellId` is omitted for `send`, `tail`, or `kill`, the latest live shell is used.

## Slash command

```text
/shells
```

Opens a fuzzy picker of this runtime's **persistent** shells, showing each shell's friendly name, shell id, and cwd. Selecting one switches the current tmux client on the shared `default` server to that session. Requires Pi to be running in a client on that server. Private shells are excluded; use the tool's `tail` action to inspect them.

## Debug flag

```nu
pi --debug-interactive-shell 'printf READY; sleep 1' -p ping
```

Runs the private spawn → send → tail → kill → shutdown path directly and prints JSON, without waiting for an agent tool call. The result includes the private socket path, whose directory should no longer exist after completion.

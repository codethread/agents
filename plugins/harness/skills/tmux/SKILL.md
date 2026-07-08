---
name: tmux
description: >
  Minimal tmux workflow for running long-lived commands in named sessions: create a
  session, send commands, inspect recent output, stop a process, kill a session, and
  keep names consistent for search and cleanup. Use when an agent needs a durable
  terminal session for servers, watchers, REPLs, or commands that may need later
  inspection.
---

# tmux

Use tmux for durable terminal work: dev servers, file watchers, REPLs, or long-running
commands whose output you need to inspect later.

## Variables

| Variable       | Value                      | Notes                                     |
| -------------- | -------------------------- | ----------------------------------------- |
| `NAME_PREFIX`  | `agent`                    | Stable prefix for easy search and cleanup |
| `TASK_SLUG`    | short lowercase kebab-case | Project/task label, e.g. `api-dev-server` |
| `SESSION_NAME` | `NAME_PREFIX-TASK_SLUG`    | Full tmux session name                    |
| `PANE_SHELL`   | detected from tmux pane    | Usually `bash`, `zsh`, `fish`, or `nu`    |
| `TAIL_LINES`   | `80`                       | Default output lines to inspect           |

## Knowledge

### Naming convention

Use predictable names so sessions are easy to find and clean up:

```text
agent-<task-slug>
```

Examples:

- `agent-api-dev-server`
- `agent-vitest-watch`
- `agent-rails-console`

Keep names lowercase, kebab-case, and specific enough to identify the task. Reuse the
same name for the same task so reruns replace stale sessions instead of accumulating
near-duplicates.

### Core commands

```bash
# List matching sessions
tmux list-sessions -F '#S' | rg '^agent-'

# Create a detached session running a command
tmux new-session -d -s "$SESSION_NAME" -c "$PWD" '<command>'

# Create an idle shell session
tmux new-session -d -s "$SESSION_NAME" -c "$PWD"

# Detect the shell actually running inside the tmux pane
tmux display-message -p -t "$SESSION_NAME" '#{pane_current_command}'

# Send literal input to an existing session, then press Enter
tmux send-keys -l -t "$SESSION_NAME" '<command>'
tmux send-keys -t "$SESSION_NAME" C-m

# Send a literal multi-command shell block from a bash/zsh caller, then press Enter if needed
tmux send-keys -l -t "$SESSION_NAME" $'first command\rsecond command'
tmux send-keys -t "$SESSION_NAME" C-m

# Capture the last N lines of output
tmux capture-pane -p -t "$SESSION_NAME" -S -"$TAIL_LINES"

# Capture all visible/history output
tmux capture-pane -p -t "$SESSION_NAME" -S -

# Stop the foreground process politely with Ctrl-C
tmux send-keys -t "$SESSION_NAME" C-c

# Close the shell politely
tmux send-keys -l -t "$SESSION_NAME" exit
tmux send-keys -t "$SESSION_NAME" C-m

# Kill the session immediately
tmux kill-session -t "$SESSION_NAME"
```

## Procedures

### Start a durable command

1. Choose `TASK_SLUG` and set `SESSION_NAME="agent-$TASK_SLUG"`.
2. Check whether that session already exists:

   ```bash
   tmux has-session -t "$SESSION_NAME" 2>/dev/null
   ```

3. If it exists and belongs to the same task, either reuse it or kill it before starting a fresh run:

   ```bash
   tmux kill-session -t "$SESSION_NAME"
   ```

4. Start the command in a detached session from the current working directory:

   ```bash
   tmux new-session -d -s "$SESSION_NAME" -c "$PWD" '<command>'
   ```

5. Capture recent output to confirm it started:

   ```bash
   tmux capture-pane -p -t "$SESSION_NAME" -S -80
   ```

### Detect the pane shell

Run this before sending shell-specific commands or examples to an idle tmux shell:

```bash
PANE_SHELL="$(tmux display-message -p -t "$SESSION_NAME" '#{pane_current_command}')"
printf 'tmux pane shell: %s\n' "$PANE_SHELL"
```

Treat `PANE_SHELL` as the syntax target for commands sent into the pane. Do not assume
bash: `zsh`, `fish`, and `nu` differ for variables, arrays, conditionals, multiline
strings, and command substitution.

### Inspect output later

1. Confirm the session exists:

   ```bash
   tmux list-sessions -F '#S' | rg '^agent-'
   ```

2. Tail recent output:

   ```bash
   tmux capture-pane -p -t "$SESSION_NAME" -S -80
   ```

3. Increase the line count if the relevant output scrolled off the recent tail:

   ```bash
   tmux capture-pane -p -t "$SESSION_NAME" -S -200
   ```

### Interact with a running session

1. Detect the shell actually running in the pane before sending shell-specific syntax:

   ```bash
   PANE_SHELL="$(tmux display-message -p -t "$SESSION_NAME" '#{pane_current_command}')"
   printf 'tmux pane shell: %s\n' "$PANE_SHELL"
   ```

2. Prefer `send-keys -l` for commands or pasted blocks so tmux treats text as
   literal UTF-8 instead of looking up key names. Send control keys like `C-m`
   separately:

   ```bash
   tmux send-keys -l -t "$SESSION_NAME" '<command>'
   tmux send-keys -t "$SESSION_NAME" C-m
   ```

3. For multi-command shell input from a bash/zsh caller, use shell quoting or another
   command-builder that preserves carriage returns, then send Enter separately if the
   final line should run:

   ```bash
   tmux send-keys -l -t "$SESSION_NAME" $'first command\rsecond command'
   tmux send-keys -t "$SESSION_NAME" C-m
   ```

4. Use `C-c` to interrupt a foreground process:

   ```bash
   tmux send-keys -t "$SESSION_NAME" C-c
   ```

5. Capture output after each interaction before deciding the next step.

### Clean up sessions

1. List agent-owned sessions:

   ```bash
   tmux list-sessions -F '#S' | rg '^agent-'
   ```

2. Politely exit sessions that are just shells:

   ```bash
   tmux send-keys -l -t "$SESSION_NAME" exit
   tmux send-keys -t "$SESSION_NAME" C-m
   ```

3. Kill sessions that are no longer needed or did not exit:

   ```bash
   tmux kill-session -t "$SESSION_NAME"
   ```

4. Bulk cleanup only the names you own:

   ```bash
   tmux list-sessions -F '#S' | rg '^agent-' | xargs -r -n1 tmux kill-session -t
   ```

## Constraints

- Never use vague session names like `test`, `server`, or `tmp`.
- Never kill sessions that do not match the agreed `agent-` naming pattern unless the user explicitly identifies them.
- Always capture output after starting, interrupting, or sending input to a session.
- Always detect `PANE_SHELL` before sending syntax that differs across bash, zsh, fish,
  or nushell.
- Prefer polite shutdown (`C-c`, then `exit`) before `kill-session` when preserving logs or graceful process cleanup matters.
- Do not leave long-running sessions behind unless the user needs them for follow-up inspection.

## Validation

- [ ] `tmux list-sessions -F '#S'` shows the expected session after start, or no longer shows it after cleanup.
- [ ] `tmux display-message -p -t "$SESSION_NAME" '#{pane_current_command}'` was checked before sending shell-specific syntax.
- [ ] `tmux capture-pane -p -t "$SESSION_NAME" -S -80` shows the relevant recent output before reporting status.
- [ ] Any remaining session names follow `agent-<task-slug>` and are intentionally left running.

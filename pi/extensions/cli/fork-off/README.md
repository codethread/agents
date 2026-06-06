# fork-off

Registers `/fork-off`, a tmux helper for opening a fork of the current session in a new tmux window without replacing the current Pi session.

## Usage

```text
/fork-off
```

The command:

1. shows a queued notification/status if the agent is currently busy,
2. waits until the current agent turn is idle,
3. reads the current persisted session file,
4. runs `tmux new-window -c <cwd> sh -lc 'pi --fork <session-file>; exec $SHELL'`.

The new window stays open if child Pi exits so errors remain visible.

Extra whitespace-separated arguments are appended after the session file:

```text
/fork-off --model openai/gpt-5.4-nano:low
```

## Requirements

- Must be running inside tmux (`TMUX` is set).
- The current Pi session must be persisted; `/fork-off` does not work with `--no-session`.


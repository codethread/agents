# fork-off

Registers `/fork-off`, a tmux helper for opening a fork of the current session in a new tmux window without replacing the current Pi session.

## Usage

```text
/fork-off
```

The command:

1. if the agent is currently busy, finds the last completed assistant message from before the active agent turn and prepares a temporary pruned session ending there,
2. otherwise waits until the session is idle and uses the current persisted session file,
3. runs `tmux new-window -c <cwd> sh -lc 'pi --fork <session-file>; exec $SHELL'`.

This means you can send a message, realize you want to branch from the previous answer, and run `/fork-off` immediately without waiting for the current agent work to finish. The current Pi session keeps running while the fork opens in a new tmux window. The new window stays open if child Pi exits so errors remain visible.

With no arguments, `/fork-off` opens a fuzzy model selector containing every authenticated model before launching the forked session. The current model is listed first when available, followed by the preferred models below in order. Any remaining authenticated models retain their registry order.

Preferred models (shown first):

- `openai-codex/gpt-5.6-tera`
- `openai-codex/gpt-5.6-luna`
- `anthropic/claude-sonnet-4-6`
- `anthropic/claude-opus-4-8`

Extra whitespace-separated arguments skip the selector and are appended after the session file:

```text
/fork-off --model openai/gpt-5.4-nano:low
```

## Requirements

- Must be running inside tmux (`TMUX` is set).
- The current Pi session must be persisted; `/fork-off` does not work with `--no-session`.

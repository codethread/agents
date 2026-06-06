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

With no arguments, `/fork-off` opens a narrowed model selector before launching the forked session. The current model is listed first when it is one of the preferred models.

Preferred models:

- `openai-codex/gpt-5.5`
- `openai-codex/gpt-5.4`
- `openai-codex/gpt-5.4-mini`
- `anthropic/claude-haiku-4-5`
- `anthropic/claude-sonnet-4-6`
- `anthropic/claude-opus-4-6`
- `anthropic/claude-opus-4-8`

Extra whitespace-separated arguments skip the selector and are appended after the session file:

```text
/fork-off --model openai/gpt-5.4-nano:low
```

## Requirements

- Must be running inside tmux (`TMUX` is set).
- The current Pi session must be persisted; `/fork-off` does not work with `--no-session`.


# Pi Extensions

Small index for the extensions shipped in this package. See each extension folder for full docs.

> [!NOTE]
> **Note on Cache Invalidation:** When working with dynamic context injections and extensions, understand that modifying the system prompt mid-session (or changing the model/provider) completely drops the LLM Prompt Cache. This forces the entire conversation prefix to be reprocessed, increasing latency and cost. Ensure this is a mindful tradeoff in your extension design. See `specs/notes--discovery.md` for detailed cache management and "Lost in the Middle" attention strategies.

## Tools

| Extension                                          | Summary                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`subagent`](./tools/subagent/README.md)           | Delegate tasks to specialized subagents with isolated context, or inherit one discovered agent config via `--agent`. |
| [`questionnaire`](./tools/questionnaire/README.md) | Structured question forms opened in your external editor.                                                            |

## UI

| Extension                                                         | Summary                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| [`read-compact`](./ui/read-compact/README.md)                     | Compact file read display — transparent to the user.    |
| [`bash-compact`](./ui/bash-compact/README.md)                     | Compact shell output display — transparent to the user. |
| [`current-context-footer`](./ui/current-context-footer/README.md) | Persistent status bar — transparent to the user.        |

## System prompt

| Extension                                                                        | Summary                                                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`dynamic-agents-md`](./system-prompt/dynamic-agents-md/README.md)               | Render a Nunjucks template into the system prompt.                                                                                          |
| [`owned-system-prompt`](./system-prompt/owned-system-prompt/README.md)           | Own Pi's base prompt scaffold while preserving later prompt chaining.                                                                       |
| [`project-structure-prompt`](./system-prompt/project-structure-prompt/README.md) | Append a bounded repository tree snapshot to the system prompt.                                                                             |
| [`pi-discovery`](./system-prompt/pi-discovery/README.md)                         | Append Pi runtime source paths plus discovered extension source paths as a one-shot contextual note when the user explicitly mentions `Pi`. |

## Messages

| Extension                                                     | Summary                                                        |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| [`tldr`](./messages/tldr/README.md)                           | Generate a catch-up summary of the current session.            |
| [`tmux-window-title`](./messages/tmux-window-title/README.md) | Set the current tmux window title from the first user message. |

## Internal shared code

- [`shared/`](./shared/) — shared utilities used by multiple extensions; not a loadable extension.

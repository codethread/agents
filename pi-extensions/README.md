# Pi Extensions

Small index for the extensions shipped in this package. See each extension folder for full docs.

> [!NOTE]
> **Note on Cache Invalidation:** When working with dynamic context injections and extensions, understand that modifying the system prompt mid-session (or changing the model/provider) completely drops the LLM Prompt Cache. This forces the entire conversation prefix to be reprocessed, increasing latency and cost. Ensure this is a mindful tradeoff in your extension design. See `specs/notes--discovery.md` for detailed cache management and "Lost in the Middle" attention strategies.

## Tools

| Extension                                          | Summary                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`subagent`](./tools/subagent/README.md)           | Delegate one task to a specialized subagent with isolated context, or inherit one discovered agent config via `--agent`. |
| [`questionnaire`](./tools/questionnaire/README.md) | Structured question forms opened in your external editor.                                                                |

## UI

| Extension                                                   | Summary                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| [`read`](./tools/read/README.md)                            | Compact file read display — transparent to the user.                |
| [`bash`](./tools/bash/README.md)                            | Compact shell output display — transparent to the user.             |
| [`statusline`](./ui/statusline/README.md)                   | Persistent status bar — transparent to the user.                    |
| [`theme-sync`](./ui/theme-sync/README.md)                   | Keep `rose-pine` selected while swapping Dawn/Moon from a sentinel. |
| [`timeline-timestamps`](./ui/timeline-timestamps/README.md) | Show recent tool-call timestamps in the footer.                     |
| [`print-mode-exit`](./ui/print-mode-exit/README.md)         | Force stuck `pi -p` processes to exit after `agent_end`.            |

## Context management

| Extension                                                     | Summary                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`pi-discovery`](./context-management/pi-discovery/README.md) | One-shot Pi runtime + extension source discovery note injected into user input when the user explicitly says `Pi`. |

## System prompt

| Extension                                    | Summary                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`system-prompt`](./system-prompt/README.md) | Merged prompt-layer extension: owns the base scaffold and injects rendered rules + project structure. |

## Messages

| Extension                                               | Summary                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| [`tldr`](./ui/tldr/README.md)                           | Generate a catch-up summary of the current session.            |
| [`tmux-window-title`](./ui/tmux-window-title/README.md) | Set the current tmux window title from the first user message. |

## Internal shared code

- [`components/`](./components/README.md) — reusable UI components for extensions; not a loadable extension.
- [`shared/`](./shared/) — shared utilities used by multiple extensions; not a loadable extension.

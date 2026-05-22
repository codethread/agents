# Pi Extensions

Small index for the extensions shipped in this package. See each extension folder for full docs.

> [!NOTE]
> **Note on Cache Invalidation:** When working with dynamic context injections and extensions, understand that modifying the system prompt mid-session (or changing the model/provider) completely drops the LLM Prompt Cache. This forces the entire conversation prefix to be reprocessed, increasing latency and cost. Ensure this is a mindful tradeoff in your extension design. See `specs/notes--discovery.md` for detailed cache management and "Lost in the Middle" attention strategies.

## Tools

| Extension                                                  | Summary                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`subagent`](./tools/subagent/README.md)                   | Delegate to isolated agents or configured swarms, and inherit one discovered agent config via `--agent`. |
| [`interactive-shell`](./tools/interactive-shell/README.md) | Spawn and control interactive shell panes for TUIs, REPLs, dev servers, and watch processes.             |
| [`pi-internals`](./tools/pi-internals/README.md)           | Print Pi runtime/source/settings/enabled-extension paths on demand.                                      |

## UI

| Extension                                                   | Summary                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`builtins`](./tools/builtins/README.md)                    | Compact built-in `read` and `bash` displays — transparent to the user. |
| [`statusline`](./ui/statusline/README.md)                   | Persistent status bar — transparent to the user.                       |
| [`emote`](./ui/emote/README.md)                             | Kitty-first animated avatar widget vendored from pi-emote.             |
| [`theme-sync`](./ui/theme-sync/README.md)                   | Keep `rose-pine` selected while swapping Dawn/Moon from a sentinel.    |
| [`timeline-timestamps`](./ui/timeline-timestamps/README.md) | Show recent tool-call timestamps in the footer.                        |

## CLI

| Extension                                            | Summary                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`print-mode-exit`](./cli/print-mode-exit/README.md) | Force stuck `pi -p` processes to exit after `agent_end`.                                         |
| [`session-name`](./cli/session-name/README.md)       | Set Pi's session display name from `--name` so `/tree` and session selectors are easier to scan. |

## System prompt

| Extension                                    | Summary                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| [`system-prompt`](./system-prompt/README.md) | Prompt-layer extension: owns the base scaffold and injects rendered rules. |

## Messages

| Extension                                                      | Summary                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`project-structure`](./messaging/project-structure/README.md) | Send a bounded project tree as model-visible custom message context. |
| [`tldr`](./ui/tldr/README.md)                                  | Generate a catch-up summary of the current session.                  |
| [`tmux-window-title`](./ui/tmux-window-title/README.md)        | Set the current tmux window title from the first user message.       |

## Internal shared code

- [`components/`](./components/README.md) — reusable UI components for extensions; not a loadable extension.
- [`shared/`](./shared/) — shared utilities used by multiple extensions; not a loadable extension.

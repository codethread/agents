# Pi Extensions

Small index for the extensions shipped in this package. See each extension folder for full docs.

Project-local extensions for this checkout live under `../.pi/extensions/` and are not shipped by this package.

> [!NOTE]
> **Note on Cache Invalidation:** Changing prompt-layer context mid-session, or changing the model/provider, can drop provider prompt-cache reuse. Treat dynamic context injection as a cost/latency tradeoff; keep injected context bounded and stable when possible.

## Tools

| Extension                                                  | Summary                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`subagent`](./tools/subagent/README.md)                   | Delegate to isolated agents or configured swarms, and inherit one discovered agent config via `--agent`. |
| [`interactive-shell`](./tools/interactive-shell/README.md) | Spawn and control interactive shell panes for TUIs, REPLs, dev servers, and watch processes.             |
| [`builtins`](./tools/builtins/README.md)                   | Register compact built-in `read` and `bash` tools.                                                       |
| [`web-access`](./tools/web-access/README.md)               | Simple Exa-backed `web_search` plus HTTP(S) `fetch_content`.                                             |

## UI

| Extension                                                   | Summary                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| [`statusline`](./ui/statusline/README.md)                   | Persistent status bar — transparent to the user.                    |
| [`emote`](./ui/emote/README.md)                             | Kitty-first animated avatar widget vendored from pi-emote.          |
| [`theme-sync`](./ui/theme-sync/README.md)                   | Keep `rose-pine` selected while swapping Dawn/Moon from a sentinel. |
| [`timeline-timestamps`](./ui/timeline-timestamps/README.md) | Show recent tool-call timestamps in the footer.                     |

## CLI

| Extension                                            | Summary                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`print-mode-exit`](./cli/print-mode-exit/README.md) | Force stuck `pi -p` processes to exit after `agent_end`.                                         |
| [`session-name`](./cli/session-name/README.md)       | Set Pi's session display name from `--name` so `/tree` and session selectors are easier to scan. |

## System prompt

| Extension                                    | Summary                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`system-prompt`](./system-prompt/README.md) | Prompt-layer extension: replaces Pi's generated prompt with owned structure and rendered rules. |

## Messaging

| Extension                                                      | Summary                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`project-structure`](./messaging/project-structure/README.md) | Send a bounded project tree as model-visible custom message context.                                   |
| [`project-rules`](./messaging/project-rules/README.md)         | Send path-scoped `.claude/rules` and `.agents/rules` as visible model context when files trigger them. |

## Session UI utilities

| Extension                                               | Summary                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| [`tldr`](./ui/tldr/README.md)                           | Generate a catch-up summary of the current session.            |
| [`tmux-window-title`](./ui/tmux-window-title/README.md) | Set the current tmux window title from the first user message. |

## Internal shared code

- [`components/`](./components/README.md) — reusable UI components for extensions; not a loadable extension.
- [`shared/`](./shared/) — shared utilities used by multiple extensions; not a loadable extension.

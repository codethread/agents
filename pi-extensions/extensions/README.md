# Pi Extensions

Small index for the extensions shipped in this package. See each extension folder for full docs.

## Tools

| Extension                                    | Summary                                                        |
| -------------------------------------------- | -------------------------------------------------------------- |
| [`subagent`](./subagent/README.md)           | Delegate tasks to specialized subagents with isolated context. |
| [`questionnaire`](./questionnaire/README.md) | Structured question forms opened in your external editor.      |

## UI Extensions

| Extension                                                      | Summary                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| [`read-compact`](./read-compact/README.md)                     | Compact file read display — transparent to the user.    |
| [`bash-compact`](./bash-compact/README.md)                     | Compact shell output display — transparent to the user. |
| [`current-context-footer`](./current-context-footer/README.md) | Persistent status bar — transparent to the user.        |

## Lifecycle / Prompt Extensions

| Extension                                            | Summary                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`claude-sync`](./claude-sync/README.md)             | Synchronize Claude project context with Pi — transparent to the user.                                          |
| [`dynamic-agents-md`](./dynamic-agents-md/README.md) | Render a Nunjucks template into the system prompt.                                                             |
| [`pi-discovery`](./pi-discovery/README.md)           | Append discovered extension source paths as a one-shot contextual note when the user explicitly mentions `Pi`. |

## Session Utilities

| Extension                                            | Summary                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| [`tldr`](./tldr/README.md)                           | Generate a catch-up summary of the current session.            |
| [`tmux-window-title`](./tmux-window-title/README.md) | Set the current tmux window title from the first user message. |

## Internal shared code

- [`shared/`](./shared/) — shared utilities used by multiple extensions; not a loadable extension.

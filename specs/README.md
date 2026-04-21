# Specifications

Persistent domain specifications. Organized by system area, not feature chronology.

**Rule:** specs describe intent, code describes reality. Always check the codebase before assuming a spec is fully implemented.

## Shared Notes

| Spec                                         | Purpose                                                                                                                  | Code                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| [notes--discovery.md](./notes--discovery.md) | Living cross-cutting notes and implementation discoveries that should be checked when creating or updating future specs. | `specs/notes--discovery.md` |

## Cross-Cutting Architecture

| Spec                                                       | Purpose                                                                                                                                                                        | Code                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| [system-prompt--assembly.md](./system-prompt--assembly.md) | Documents the full system prompt assembly pipeline: phase ordering, injection mechanisms, extension load-order constraints, and invariants for prompt-contributing extensions. | Cross-cutting; see individual extension specs |

## Reference READMEs

- `README.md` — package overview and setup
- `pi-extensions/README.md` — extension index; per-extension README files live inside each extension folder

## Delegation and Resource Sync

| Spec                                                                     | Purpose                                                                                                                                     | Code                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [subagent--discovery-and-config.md](./subagent--discovery-and-config.md) | Defines how bundled, user, and project agents are discovered, normalized, and handed to subagent runtime execution.                         | `pi-extensions/subagent/`, `pi-agents/*.md`                        |
| [subagent--orchestration.md](./subagent--orchestration.md)               | Defines subagent runtime execution: mode dispatch, isolated child-process orchestration, streaming updates, confirmation, and UI rendering. | `pi-extensions/subagent/`, `pi-extensions/current-context-footer/` |
| [claude--sync-integration.md](./claude--sync-integration.md)             | Defines Claude-to-Pi syncing: scope discovery, symlink safety rules, command-name translation, lifecycle gating, and result notifications.  | `pi-extensions/claude-sync/`                                       |

## Prompt and Context Injection

| Spec                                                                                           | Purpose                                                                                                                                                          | Code                                 |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| [system-prompt--dynamic-template-injection.md](./system-prompt--dynamic-template-injection.md) | Defines global/project `agent.njk` discovery, Nunjucks rendering, prompt injection, and prompt-debug surfaces for the `dynamic-agents-md` extension.             | `pi-extensions/dynamic-agents-md/`   |
| [pi--extension-discovery.md](./pi--extension-discovery.md)                                     | Defines discovery of enabled Pi extension entrypoints plus conditional contextual-note/debug exposure of their source paths for the `pi-discovery` extension.    | `pi-extensions/pi-discovery/`        |
| [system-prompt--ownership.md](./system-prompt--ownership.md)                                   | Defines how the `owned-system-prompt` extension replaces Pi's default tool/guideline sections with a controlled scaffold while preserving later prompt chaining. | `pi-extensions/owned-system-prompt/` |

## Presentation and UX

| Spec                                                                   | Purpose                                                                                                                                                       | Code                                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [presentation--extension-layer.md](./presentation--extension-layer.md) | Defines compact tool rendering, session footer behavior, shared usage-display formatting, and theme token mapping.                                            | `pi-extensions/bash-compact/`, `pi-extensions/read-compact/`, `pi-extensions/current-context-footer/`, `pi-themes/rose-pine.json` |
| [questionnaire--interaction.md](./questionnaire--interaction.md)       | Defines the questionnaire tool as an external-editor-backed markdown form, including question normalization, validation retries, parsing, and result display. | `pi-extensions/questionnaire/`                                                                                                    |
| [session--tldr-summary.md](./session--tldr-summary.md)                 | Defines `/tldr` session summarization, transcript extraction, small-model selection, debug flags, and hidden-from-agent summary presentation.                 | `pi-extensions/tldr/`                                                                                                             |

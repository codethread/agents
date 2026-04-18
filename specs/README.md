# Specifications

Persistent domain specifications. Organized by system area, not feature chronology.

**Rule:** specs describe intent, code describes reality. Always check the codebase before assuming a spec is fully implemented.

## Shared Notes

| Spec                           | Purpose                                                                                                                  | Code                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| [discovery.md](./discovery.md) | Living cross-cutting notes and implementation discoveries that should be checked when creating or updating future specs. | `specs/discovery.md` |

## Reference READMEs

- `README.md` — package overview and setup
- `pi-extensions/extensions/README.md` — extension index; per-extension README files live inside each extension folder

## Delegation and Resource Sync

| Spec                                                             | Purpose                                                                                                                                     | Code                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [agent-discovery-and-config.md](./agent-discovery-and-config.md) | Defines how bundled, user, and project agents are discovered, normalized, and handed to subagent runtime execution.                         | `pi-extensions/extensions/subagent/`, `pi-agents/*.md`                                   |
| [subagent-orchestration.md](./subagent-orchestration.md)         | Defines subagent runtime execution: mode dispatch, isolated child-process orchestration, streaming updates, confirmation, and UI rendering. | `pi-extensions/extensions/subagent/`, `pi-extensions/extensions/current-context-footer/` |
| [claude-sync-integration.md](./claude-sync-integration.md)       | Defines Claude-to-Pi syncing: scope discovery, symlink safety rules, command-name translation, lifecycle gating, and result notifications.  | `pi-extensions/extensions/claude-sync/`                                                  |

## Prompt and Context Injection

| Spec                                                                           | Purpose                                                                                                                                                       | Code                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [dynamic-agents-template-injection.md](./dynamic-agents-template-injection.md) | Defines global/project `agent.njk` discovery, Nunjucks rendering, prompt injection, and prompt-debug surfaces for the `dynamic-agents-md` extension.          | `pi-extensions/extensions/dynamic-agents-md/`                                              |
| [pi-extension-discovery.md](./pi-extension-discovery.md)                       | Defines discovery of enabled Pi extension entrypoints plus conditional contextual-note/debug exposure of their source paths for the `pi-discovery` extension. | `pi-extensions/extensions/pi-discovery/`                                                   |
| [system-prompt-ownership.md](./system-prompt-ownership.md)                     | Records discovery findings and the implemented design for owning Pi's base prompt scaffold while preserving later prompt chaining.                            | `pi-extensions/extensions/owned-system-prompt/`, `specs/fixtures/system-prompt-ownership/` |

## Presentation and UX

| Spec                                                                 | Purpose                                                                                                                                                       | Code                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [extension-presentation-layer.md](./extension-presentation-layer.md) | Defines compact tool rendering, session footer behavior, shared usage-display formatting, and theme token mapping.                                            | `pi-extensions/extensions/bash-compact/`, `pi-extensions/extensions/read-compact/`, `pi-extensions/extensions/current-context-footer/`, `pi-extensions/themes/rose-pine.json` |
| [questionnaire-interaction.md](./questionnaire-interaction.md)       | Defines the questionnaire tool as an external-editor-backed markdown form, including question normalization, validation retries, parsing, and result display. | `pi-extensions/extensions/questionnaire/`                                                                                                                                     |
| [session-tldr-summary.md](./session-tldr-summary.md)                 | Defines `/tldr` session summarization, transcript extraction, small-model selection, debug flags, and hidden-from-agent summary presentation.                 | `pi-extensions/extensions/tldr/`                                                                                                                                              |

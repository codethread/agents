# Specifications

Persistent domain specifications. Organized by system area, not feature chronology.

**Rule:** specs describe intent, code describes reality. Always check the codebase before assuming a spec is fully implemented.

## Shared Notes

| Spec                           | Purpose                                                                                                                  | Code                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [discovery.md](./discovery.md) | Living cross-cutting notes and implementation discoveries that should be checked when creating or updating future specs. | `specs/discovery.md` |

## Subagent Extension

| Spec                                                             | Purpose                                                                                                                                     | Code                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [agent-discovery-and-config.md](./agent-discovery-and-config.md) | Defines how bundled, user, and project agents are discovered, normalized, and handed to subagent runtime execution.                         | `pi-extensions/extensions/subagent/agents.ts`, `pi-extensions/extensions/subagent/index.ts`, `pi-extensions/agents/*.md` |
| [subagent-orchestration.md](./subagent-orchestration.md)         | Defines subagent runtime execution: mode dispatch, isolated child-process orchestration, streaming updates, confirmation, and UI rendering. | `pi-extensions/extensions/subagent/index.ts`, `pi-extensions/extensions/usage-format.ts`                                 |
| [claude-sync-integration.md](./claude-sync-integration.md)       | Defines Claude-to-Pi syncing: scope discovery, symlink safety rules, command-name translation, lifecycle gating, and result notifications.  | `pi-extensions/extensions/claude-sync.ts`                                                                                |

## Presentation and UX

| Spec                                                                 | Purpose                                                                                                                                                | Code                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [extension-presentation-layer.md](./extension-presentation-layer.md) | Defines compact tool rendering, session footer behavior, shared usage-display formatting, and theme token mapping.                                     | `pi-extensions/extensions/bash-compact.ts`, `pi-extensions/extensions/read-compact.ts`, `pi-extensions/extensions/current-context-footer.ts`, `pi-extensions/extensions/usage-format.ts`, `pi-extensions/themes/rose-pine.json` |
| [questionnaire-interaction.md](./questionnaire-interaction.md)       | Defines the interactive questionnaire tool, including question normalization, tabbed navigation, custom-answer entry, and structured result reporting. | `pi-extensions/extensions/questionnaire.ts`, `pi-extensions/extensions/README.md`                                                                                                                                               |

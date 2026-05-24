# Specifications

Persistent domain specifications. Organized by system area, not feature chronology.

**Rule:** specs describe intent, code describes reality. Always check the codebase before assuming a spec is fully implemented.

## Cross-Cutting Architecture

| Spec                                                       | Purpose                                                                                                                                                                                       | Code                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [system-prompt--assembly.md](./system-prompt--assembly.md) | Defines package-owned system prompt assembly: full prompt replacement, dynamic template injection, debug surfaces, and the boundary between system-prompt context and custom-message context. | `pi-extensions/system-prompt/`                             |
| [project-rules--autoload.md](./project-rules--autoload.md) | Defines project-local `.claude/rules` and `.agents/rules` loading, overrides, system-prompt rules, and path-triggered rule messages.                                                          | `pi-extensions/system-prompt/`, `pi-extensions/messaging/` |

## Reference READMEs

- `README.md` — package overview and setup
- `pi-extensions/README.md` — package extension index; per-extension README files live inside each shipped extension folder
- `.pi/extensions/pi-internals/README.md` — project-local Pi internals extension for this checkout only

## Workflow Automation

| Spec                                                                                 | Purpose                                                                                                           | Code                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [afk-loop--single-worktree-automation.md](./afk-loop--single-worktree-automation.md) | Defines the AFK loop as a prompt-plus-script system for synchronous task execution, retry recovery, and finalise. | `scripts/afk-loop.nu`, `prompts/afk*.md`, `prompts/hitl.md` |

## Delegation and Resource Sync

| Spec                                                                           | Purpose                                                                                                                           | Code                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [subagent--discovery-and-config.md](./subagent--discovery-and-config.md)       | Defines how bundled, user, and project agents and swarms are discovered, normalized, and handed to subagent runtime execution.    | `pi-extensions/tools/subagent/`, `pi-agents/`                   |
| [subagent--dynamic-model-selection.md](./subagent--dynamic-model-selection.md) | Defines dynamic subagent model chains, environment-gated candidates, validation, retry/advance behavior, and metadata boundaries. | `pi-extensions/tools/subagent/`, `pi-agents/`                   |
| [subagent--orchestration.md](./subagent--orchestration.md)                     | Defines subagent runtime execution: single-agent runs, swarm fan-out, persisted resume, streaming updates, and UI rendering.      | `pi-extensions/tools/subagent/`, `pi-extensions/ui/statusline/` |

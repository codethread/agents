# Specifications

Persistent domain specifications. Organized by system area, not feature chronology.

**Rule:** specs describe intent, code describes reality. Always check the codebase before assuming a spec is fully implemented.

## Cross-Cutting Architecture

| Spec                                                       | Purpose                                                                                                                                                                                       | Code                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [system-prompt--assembly.md](./system-prompt--assembly.md) | Defines package-owned system prompt assembly: full prompt replacement, dynamic template injection, debug surfaces, and the boundary between system-prompt context and custom-message context. | `pi/extensions/system-prompt/`                             |
| [project-rules--autoload.md](./project-rules--autoload.md) | Defines project-local `.claude/rules` and `.agents/rules` loading, overrides, system-prompt rules, and path-triggered rule messages.                                                          | `pi/extensions/system-prompt/`, `pi/extensions/messaging/` |
| [prompt-history.md](./prompt-history.md)                   | Defines cross-session prompt history storage and recall scopes for exact cwd, canonical git repo root, and global prompt recall.                                                              | `pi/extensions/ui/prompt-history/`                         |

## Reference READMEs

- `README.md` — package overview and setup
- `pi/extensions/README.md` — package extension index; per-extension README files live inside each shipped extension folder
- `plugins/devflow/README.md` — AFK/HITL workflow automation overview
- `.pi/extensions/pi-internals/README.md` — project-local Pi internals extension for this checkout only

## Delegation and Resource Sync

| Spec                                                                           | Purpose                                                                                                                           | Code                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [subagent--discovery-and-config.md](./subagent--discovery-and-config.md)       | Defines how bundled, user, and project agents and swarms are discovered, normalized, and handed to subagent runtime execution.    | `pi/extensions/tools/subagent/`, `pi/agents/`                   |
| [subagent--dynamic-model-selection.md](./subagent--dynamic-model-selection.md) | Defines dynamic subagent model chains, environment-gated candidates, validation, retry/advance behavior, and metadata boundaries. | `pi/extensions/tools/subagent/`, `pi/agents/`                   |
| [subagent--orchestration.md](./subagent--orchestration.md)                     | Defines subagent runtime execution: single-agent runs, swarm fan-out, persisted resume, streaming updates, and UI rendering.      | `pi/extensions/tools/subagent/`, `pi/extensions/ui/statusline/` |

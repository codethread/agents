# Specifications

Persistent domain specifications. Organized by system area, not feature chronology.

**Rule:** specs describe intent, code describes reality. Always check the codebase before assuming a spec is fully implemented.

## Cross-Cutting Architecture

| Spec                                                       | Purpose                                                                                                                                                                                                                                          | Code                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| [system-prompt--assembly.md](./system-prompt--assembly.md) | Documents the full system prompt assembly pipeline: `before_agent_start` chaining, `systemPromptOptions` structured inputs, separate tool-metadata weaving, extension load-order constraints, and invariants for prompt-contributing extensions. | Cross-cutting; see individual extension specs |

## Reference READMEs

- `README.md` — package overview and setup
- `pi-extensions/README.md` — extension index; per-extension README files live inside each extension folder

## Workflow Automation

| Spec                                                                                 | Purpose                                                                                                           | Code                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [afk-loop--single-worktree-automation.md](./afk-loop--single-worktree-automation.md) | Defines the AFK loop as a prompt-plus-script system for synchronous task execution, retry recovery, and finalise. | `scripts/afk-loop.nu`, `prompts/afk*.md`, `prompts/hitl.md` |

## Delegation and Resource Sync

| Spec                                                                           | Purpose                                                                                                                           | Code                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [subagent--discovery-and-config.md](./subagent--discovery-and-config.md)       | Defines how bundled, user, and project agents and swarms are discovered, normalized, and handed to subagent runtime execution.    | `pi-extensions/tools/subagent/`, `pi-agents/*.md`               |
| [subagent--dynamic-model-selection.md](./subagent--dynamic-model-selection.md) | Defines dynamic subagent model chains, environment-gated candidates, validation, retry/advance behavior, and metadata boundaries. | `pi-extensions/tools/subagent/`, `pi-agents/*.md`               |
| [subagent--orchestration.md](./subagent--orchestration.md)                     | Defines subagent runtime execution: single-agent runs, swarm fan-out, persisted resume, streaming updates, and UI rendering.      | `pi-extensions/tools/subagent/`, `pi-extensions/ui/statusline/` |

## Prompt Injection

| Spec                                                                                           | Purpose                                                                                                                                                                                                                                   | Code                                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [system-prompt--dynamic-template-injection.md](./system-prompt--dynamic-template-injection.md) | Defines global/project `agent.njk` discovery, Nunjucks rendering from structured runtime vars, prompt injection, and prompt-debug surfaces (including JSON override debugging) for the merged `system-prompt` extension's template phase. | `pi-extensions/system-prompt/`, `pi-extensions/system-prompt/dynamic-agents-md/`   |
| [system-prompt--ownership.md](./system-prompt--ownership.md)                                   | Defines how the merged `system-prompt` extension owns the base scaffold in `before_agent_start`, prefers Pi's structured selected-tool set, and preserves later prompt chaining.                                                          | `pi-extensions/system-prompt/`, `pi-extensions/system-prompt/owned-system-prompt/` |

## Context Management

| Spec                                                       | Purpose                                                                                                                                                                          | Code                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [pi--extension-discovery.md](./pi--extension-discovery.md) | Defines discovery of enabled Pi extension entrypoints plus conditional contextual-note/debug exposure of their source paths for the `pi-discovery` context-management extension. | `pi-extensions/context-management/pi-discovery/` |

## Presentation and UX

| Spec                                                   | Purpose                                                                                                                                       | Code                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [session--tldr-summary.md](./session--tldr-summary.md) | Defines `/tldr` session summarization, transcript extraction, small-model selection, debug flags, and hidden-from-agent summary presentation. | `pi-extensions/ui/tldr/` |

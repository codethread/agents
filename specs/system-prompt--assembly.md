# System Prompt Assembly Specification

**Status:** Implemented
**Last Updated:** 2026-04-22

## 1. Overview

### Purpose

Document the full system prompt assembly pipeline across Pi core and all prompt-contributing extensions, providing a single architectural reference for how the final prompt reaching the model is constructed.

### Goals

- Map the complete assembly pipeline from Pi core's prompt builder and structured `systemPromptOptions` inputs through extension hooks and tool metadata weaving.
- Document ordering constraints that affect prompt composition.
- Define the two distinct injection mechanisms used by the system.
- Establish invariants that new prompt-contributing extensions must preserve.

### Non-Goals

- Replacing individual extension specs.
- Specifying the content of any prompt section.
- Redefining Pi core prompt-building behavior beyond what is needed to describe the assembly pipeline.

## 2. Design Decisions

- **Decision:** This is a cross-cutting spec that references child specs instead of duplicating them.
  - **Rationale:** Prompt assembly spans several behaviors plus one core path. Centralizing the pipeline view here avoids restating implementation details already owned by behavior-specific specs.

- **Decision:** The package now loads one merged `system-prompt` extension entrypoint instead of three sibling prompt-layer extensions.
  - **Rationale:** These behaviors share one lifecycle boundary and are easier to reason about when shipped as one prompt-layer module.

- **Decision:** Prompt phase order is still treated as explicit architecture.
  - **Rationale:** Even after the merge, scaffold ownership must happen before template and project-structure injection, and the merged entrypoint preserves that order intentionally.

- **Decision:** There are two distinct injection paths: `before_agent_start` hook mutations and `registerTool` metadata.
  - **Rationale:** System-prompt text and tool-description metadata are woven into different parts of the final model-facing context and are not governed by the same runtime path.

- **Decision:** Prompt-mutating behaviors should prefer `before_agent_start.event.systemPromptOptions` when they need the prompt builder's structured inputs.
  - **Rationale:** Pi already resolves selected tools, appended prompt text, context files, skills, and cwd before the hook fires. Reusing that structured payload avoids redundant discovery and reduces drift between extension logic and the actual prompt being built.

- **Decision:** User-input transforms such as Pi discovery remain related but out of scope for strict system prompt assembly.
  - **Rationale:** They influence the conversation context, but they do not contribute to the system prompt itself.

## 3. Architecture

The final system prompt is assembled in phases. The first three prompt-mutating phases now live inside the merged `system-prompt` extension entrypoint, while tool metadata and later prompt contributors still follow their own paths.

### 3.1 Phase 0: CLI Foundation

Pi core establishes the base prompt before any extension hook runs:

- reads `~/.pi/agent/SYSTEM.md` or the `--system-prompt` flag as the base prompt source
- appends context files, skills, current date, and current working directory
- applies `--append-system-prompt` when present
- exposes the structured prompt-builder inputs to extensions as `event.systemPromptOptions` (`customPrompt`, `selectedTools`, `toolSnippets`, `promptGuidelines`, `appendSystemPrompt`, `cwd`, `contextFiles`, `skills`)

The result is the initial `event.systemPrompt` observed by extensions plus the structured input bundle they can inspect without re-discovering resources.

### 3.2 Phase 1: Scaffold Ownership (merged `system-prompt` ownership phase)

The merged `system-prompt` extension starts with the owned-scaffold behavior formerly shipped as `owned-system-prompt`.

- When the user has provided `SYSTEM.md` and Pi's default scaffold is no longer present, it appends a package-owned tool list and guidelines block wrapped in `<system-reminder type="harness">`.
- The tool list should be derived from `event.systemPromptOptions.selectedTools` when available so the owned scaffold matches the exact prompt-builder selection.
- This phase MUST run before the later prompt appenders inside the merged extension.

Child spec: [`specs/system-prompt--ownership.md`](./system-prompt--ownership.md)

### 3.3 Phase 2: Template Injection (merged `system-prompt` template phase)

The merged `system-prompt` extension then runs the template behavior formerly shipped as `dynamic-agents-md`: it discovers a global `agent.njk` template and the nearest project `.pi/agent.njk`, then renders them with runtime variables such as model, provider, cwd, tools, agent role, and environment values. When available, the tool list should come from `event.systemPromptOptions.selectedTools` so template logic sees the same selected tools Pi is about to describe in the prompt.

Each rendered section is appended to `event.systemPrompt` inside its own `<system-reminder type="...">` wrapper: global rules use `type="rules"`, project rules use `type="project-rules"`.

Child spec: [`specs/system-prompt--dynamic-template-injection.md`](./system-prompt--dynamic-template-injection.md)

### 3.4 Phase 3: Structural Context (merged `system-prompt` project-structure phase)

The merged `system-prompt` extension then runs the project-structure behavior formerly shipped as `project-structure-prompt`, generating a bounded repository tree snapshot and appending it to `event.systemPrompt` inside `<system-reminder type="project-structure">`.

This behavior is intentionally self-contained and does not have a dedicated spec.

### 3.5 Phase 4: Agent Inventory (`subagent`)

The `subagent` extension discovers bundled, user, and project agents, then appends:

- the agent inventory listing inside `<system-reminder type="available-subagents">`, preserving an inner `<available-subagents>` list and omitting agents marked `hidden: true`
- the selected-agent prompt body inside `<system-reminder type="selected-agent-prompt">` when direct `--agent` mode is active, including when the selected agent is hidden from inventory

Child specs:

- [`specs/subagent--discovery-and-config.md`](./subagent--discovery-and-config.md)
- [`specs/subagent--orchestration.md`](./subagent--orchestration.md)

### 3.6 Phase T: Tool Metadata (parallel path)

Some extensions register tools with `promptSnippet` and `promptGuidelines`. Pi core weaves these into the tool-description section independently of `before_agent_start` hook order.

Prompt-contributing tool registrations include:

- `read`
- `bash`
- `subagent`

When the merged `system-prompt` extension's ownership phase is active, it manually vendors built-in tool metadata because Pi does not expose that metadata publicly.

### 3.7 Related: User-Input Transforms

The `pi-discovery` context-management extension injects a context note into the user message rather than the system prompt.

This mechanism is related to prompt assembly, but it is not part of the system prompt pipeline.

Child spec: [`specs/pi--extension-discovery.md`](./pi--extension-discovery.md)

## 4. Ordering Constraints

- Extension load order in `package.json#pi.extensions` still determines cross-extension `before_agent_start` execution order.
- The merged `system-prompt` extension MUST run before `subagent`, so subagent inventory chains from the fully assembled prompt-layer output.
- Inside the merged extension, ownership MUST run before template injection, which MUST run before project-structure injection.
- All prompt-contributing behaviors use append-only semantics on `event.systemPrompt`.
- Tool metadata (`promptSnippet` / `promptGuidelines`) is injected by Pi core independently of hook order.

## 5. Invariants for New Extensions

- Always append to `event.systemPrompt`; never replace it.
- Prefer `event.systemPromptOptions` over ad hoc rediscovery when you need the prompt builder's structured inputs.
- Wrap each injected prompt contribution in its own root XML tag so adjacent prose cannot bleed across section boundaries.
- Return early or no-op when your contribution is empty.
- Use `--debug-*` flags to surface your prompt contribution for verification.

## 6. Debug Surfaces

The primary verification surfaces for prompt assembly are:

- `--debug-prompt` — forces a one-shot synthetic `ping` turn, then prints the full effective prompt after all prompt-layer behaviors. It also accepts an optional JSON object string to override template vars for that debug turn.
- `/debug-prompt` — shows the last materialized effective prompt in the UI. If no turn has materialized a prompt yet, it warns the user to send a message first.

These are the only prompt-debug surfaces for the merged extension.

## 7. Open Questions

- Should prompt-phase composition eventually gain a dedicated assembly trace/debug surface that shows the intermediate prompt after each phase?
- Should Pi expose `promptSnippet` / `promptGuidelines` publicly so the ownership phase does not need to vendor them?
- Should prompt-cache-aware injection guidance (user message vs system prompt) be formalized?

## 8. Code Locations

| File                                                            | Role                                                                                                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                  | Declares the merged `system-prompt` extension entrypoint and cross-extension load order.                                                                                      |
| `pi-extensions/system-prompt/index.ts`                          | Merged prompt-layer orchestrator; owns the single `--debug-prompt` flag, `/debug-prompt` command, and Pi event hooks for ownership, template, and project-structure behavior. |
| `pi-extensions/system-prompt/owned-system-prompt/index.ts`      | Owned-scaffold prompt-building helpers.                                                                                                                                       |
| `pi-extensions/system-prompt/dynamic-agents-md/index.ts`        | Template rendering and prompt-debug helper utilities.                                                                                                                         |
| `pi-extensions/system-prompt/project-structure-prompt/index.ts` | Bounded repo-tree snapshot controller and cache helpers.                                                                                                                      |
| `pi-extensions/context-management/pi-discovery/index.ts`        | Context-management extension entrypoint for Pi-discovery user-input transforms and debug reporting.                                                                           |

| `pi-extensions/tools/subagent/index.ts` | Agent inventory and selected-agent prompt injection; `subagent` tool registration. |
| `pi-extensions/README.md` | Extension index and navigation entry point. |
| `specs/system-prompt--ownership.md` | Child spec for scaffold ownership details. |
| `specs/system-prompt--dynamic-template-injection.md` | Child spec for template-based prompt injection details. |
| `specs/subagent--discovery-and-config.md` | Child spec for agent discovery details used by subagent prompt assembly. |
| `specs/subagent--orchestration.md` | Child spec for subagent execution and runtime orchestration. |
| `specs/pi--extension-discovery.md` | Related spec for user-input contextual-note injection handled outside the system-prompt pipeline. |

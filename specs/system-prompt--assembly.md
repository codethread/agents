# System Prompt Assembly Specification

**Status:** Implemented
**Last Updated:** 2026-04-21

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
  - **Rationale:** Prompt assembly spans several extensions and one core path. Centralizing the pipeline view here avoids restating the implementation details already owned by extension-specific specs.

- **Decision:** The `before_agent_start` pipeline is ordered by extension load order in `package.json#pi.extensions`.
  - **Rationale:** Prompt mutations are effectively chained. A predictable extension order is the only practical way to reason about the final assembled prompt.

- **Decision:** There are two distinct injection paths: `before_agent_start` hook mutations and `registerTool` metadata.
  - **Rationale:** System-prompt text and tool-description metadata are woven into different parts of the final model-facing context and are not governed by the same runtime path.

- **Decision:** Prompt-mutating extensions should prefer `before_agent_start.event.systemPromptOptions` when they need the prompt builder's structured inputs.
  - **Rationale:** Pi already resolves selected tools, appended prompt text, context files, skills, and cwd before the hook fires. Reusing that structured payload avoids redundant discovery and reduces drift between extension logic and the actual prompt being built.

- **Decision:** User-input transforms such as `pi-discovery` are related but out of scope for system prompt assembly.
  - **Rationale:** They influence the conversation context, but they do not contribute to the system prompt itself.

## 3. Architecture

The final system prompt is assembled in phases. Each phase either appends to `event.systemPrompt` or contributes tool metadata through Pi core's separate tool-description path.

### 3.1 Phase 0: CLI Foundation

Pi core establishes the base prompt before any extension hook runs:

- reads `~/.pi/agent/SYSTEM.md` or the `--system-prompt` flag as the base prompt source
- appends context files, skills, current date, and current working directory
- applies `--append-system-prompt` when present
- exposes the structured prompt-builder inputs to extensions as `event.systemPromptOptions` (`customPrompt`, `selectedTools`, `toolSnippets`, `promptGuidelines`, `appendSystemPrompt`, `cwd`, `contextFiles`, `skills`)

The result is the initial `event.systemPrompt` observed by extensions plus the structured input bundle they can inspect without re-discovering resources.

### 3.2 Phase 1: Scaffold Ownership (`owned-system-prompt`)

The `owned-system-prompt` extension detects whether Pi's default scaffold is still present by checking a sentinel string.

- When the user has provided `SYSTEM.md` and the default scaffold is no longer present, the extension appends a package-owned tool list and guidelines block wrapped in `<system-reminder type="harness">`.
- The tool list should be derived from `event.systemPromptOptions.selectedTools` when available so the owned scaffold matches the exact prompt-builder selection.
- This extension MUST run first, because later `before_agent_start` hooks chain from its output.

Child spec: [`specs/system-prompt--ownership.md`](./system-prompt--ownership.md)

### 3.3 Phase 2: Template Injection (`dynamic-agents-md`)

The `dynamic-agents-md` extension discovers a global `agent.njk` template and the nearest project `.pi/agent.njk`, then renders them with runtime variables such as model, provider, cwd, tools, agent role, and environment values. When available, the tool list should come from `event.systemPromptOptions.selectedTools` so template logic sees the same selected tools Pi is about to describe in the prompt.

Each rendered section is appended to `event.systemPrompt` inside its own `<system-reminder type="...">` wrapper: global rules use `type="rules"`, project rules use `type="project-rules"`.

Child spec: [`specs/system-prompt--dynamic-template-injection.md`](./system-prompt--dynamic-template-injection.md)

### 3.4 Phase 3: Structural Context (`project-structure-prompt`)

The `project-structure-prompt` extension generates a bounded repository tree snapshot and appends it to `event.systemPrompt` inside `<system-reminder type="project-structure">`.

This extension is intentionally self-contained and does not have a dedicated spec.

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

- `read-compact`
- `bash-compact`
- `subagent`

When `owned-system-prompt` is active, it manually vendors built-in tool metadata because Pi does not expose that metadata publicly.

Child spec: [`specs/presentation--extension-layer.md`](./presentation--extension-layer.md)

### 3.7 Related: User-Input Transforms

`pi-discovery` injects a context note into the user message rather than the system prompt.

This mechanism is related to prompt assembly, but it is not part of the system prompt pipeline.

Child spec: [`specs/pi--extension-discovery.md`](./pi--extension-discovery.md)

## 4. Ordering Constraints

- Extension load order in `package.json#pi.extensions` determines `before_agent_start` execution order.
- `owned-system-prompt` MUST be first; later hooks would otherwise clobber its scaffold replacement.
- All subsequent prompt-contributing extensions use append-only semantics on `event.systemPrompt`.
- Tool metadata (`promptSnippet` / `promptGuidelines`) is injected by Pi core independently of hook order.

## 5. Invariants for New Extensions

- Always append to `event.systemPrompt`; never replace it.
- Prefer `event.systemPromptOptions` over ad hoc rediscovery when you need the prompt builder's structured inputs.
- Wrap each injected prompt contribution in its own root XML tag so adjacent prose cannot bleed across section boundaries.
- Return early or no-op when your contribution is empty.
- Use `--debug-*` flags to surface your prompt contribution for verification.

## 6. Debug Surfaces

The primary verification surfaces for prompt assembly are:

- `--debug-owned-prompt` — prints the owned scaffold output.
- `--debug-prompt` — prints the full effective prompt after all extensions.
- `/debug-prompt` — opens the effective prompt in an editor.

These surfaces are the main tools for verifying prompt assembly behavior end to end.

## 7. Open Questions

- Should there be a formal extension ordering mechanism beyond `package.json` array position?
- Should Pi expose `promptSnippet` / `promptGuidelines` publicly so `owned-system-prompt` does not need to vendor them?
- Should prompt-cache-aware injection guidance (user message vs system prompt) be formalized?

## 8. Code Locations

| File                                                 | Role                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `package.json`                                       | Declares `pi.extensions` load order used by prompt-hook chaining.                  |
| `pi-extensions/owned-system-prompt/index.ts`         | Scaffold ownership hook and owned-prompt debug flag.                               |
| `pi-extensions/dynamic-agents-md/index.ts`           | Template discovery, rendering, and prompt injection.                               |
| `pi-extensions/project-structure-prompt/index.ts`    | Bounded repo-tree snapshot injection.                                              |
| `pi-extensions/subagent/index.ts`                    | Agent inventory and selected-agent prompt injection; `subagent` tool registration. |
| `pi-extensions/tools/read/index.ts`                  | `read` tool presentation metadata.                                                 |
| `pi-extensions/tools/bash/index.ts`                  | `bash` tool presentation metadata.                                                 |
| `pi-extensions/pi-discovery/index.ts`                | User-message context note injection.                                               |
| `pi-extensions/README.md`                            | Extension index and navigation entry point.                                        |
| `specs/system-prompt--ownership.md`                  | Child spec for scaffold ownership details.                                         |
| `specs/system-prompt--dynamic-template-injection.md` | Child spec for template-based prompt injection details.                            |
| `specs/subagent--discovery-and-config.md`            | Child spec for agent discovery details used by subagent prompt assembly.           |
| `specs/subagent--orchestration.md`                   | Child spec for subagent execution and runtime orchestration.                       |
| `specs/presentation--extension-layer.md`             | Child spec for tool presentation metadata and prompt snippets.                     |
| `specs/pi--extension-discovery.md`                   | Child spec for user-input contextual-note injection.                               |

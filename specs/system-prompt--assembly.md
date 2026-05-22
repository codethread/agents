# System Prompt Assembly Specification

**Status:** Implemented  
**Last Updated:** 2026-05-22

## 1. Overview

### Purpose

Document how this package contributes model-facing prompt context: Pi core builds the base system prompt, `pi-extensions/system-prompt/` owns the package's system-prompt additions, and adjacent extensions contribute non-system context when that is the better cache/UX boundary.

### Goals

- Capture the ordering and boundaries for package-owned system-prompt assembly.
- Keep scaffold ownership and dynamic template injection in one spec.
- Distinguish stable system-prompt instructions from volatile custom-message context.
- Define invariants for future prompt-contributing extensions.

### Non-Goals

- Redefining Pi core prompt-building behavior beyond the extension contract this package relies on.
- Specifying every line of generated prompt text.
- Documenting subagent execution or project-structure snapshot mechanics in detail; those live in their extension READMEs/tests.

## 2. Design Decisions

- **Decision:** `system-prompt` owns only stable prompt-layer behavior: base scaffold ownership and dynamic rule templates.
  - **Rationale:** These are operating instructions that should live in the effective system prompt. Volatile context such as the project tree is better sent as custom message context so it can refresh without changing the system prompt.

- **Decision:** Scaffold ownership runs before dynamic template injection.
  - **Rationale:** The owned scaffold establishes the base tool/guideline shape, then global/project rules append as isolated sections.

- **Decision:** The extension prefers `before_agent_start.event.systemPromptOptions.selectedTools` over rediscovering active tools.
  - **Rationale:** Pi core already resolved the selected tool set for the prompt being built. Reusing it keeps owned tool metadata and template variables aligned with the actual request.

- **Decision:** Default Pi prompt detection uses a sentinel string rather than a full prompt comparison.
  - **Rationale:** A sentinel is stable enough to identify Pi's default scaffold without coupling to every byte of Pi's generated prompt. If the default scaffold is still present, ownership skips to avoid duplicate tool/guideline sections.

- **Decision:** Built-in tool metadata is manually vendored for the owned scaffold.
  - **Rationale:** Pi's extension API does not expose built-in `promptSnippet` / `promptGuidelines`. Manual sync is cheaper and clearer than trying to infer these strings at runtime.

- **Decision:** Dynamic rule templates support one global template and the nearest project template.
  - **Rationale:** Personal rules and repo-local rules solve different problems. A nearest-template rule avoids ambiguous multi-template stacking.

- **Decision:** Rendered template sections are XML-wrapped by scope.
  - **Rationale:** `<system-reminder type="rules">` and `<system-reminder type="project-rules">` keep adjacent instructions from bleeding together.

- **Decision:** `--debug-prompt` synthesizes a `ping` turn, while `/debug-prompt` displays the last materialized prompt only.
  - **Rationale:** The effective prompt only exists when a turn starts. Non-interactive debug mode should force materialization and exit; interactive debug should not create surprise turns.

## 3. Architecture

Implementation lives in `pi-extensions/system-prompt/`.

### 3.1 Pi Core Foundation

Before extension hooks run, Pi core establishes `event.systemPrompt` from its base prompt inputs:

- user `SYSTEM.md` or `--system-prompt`
- context files, skills, current date, cwd
- `--append-system-prompt`
- selected tools and tool metadata surfaced through `event.systemPromptOptions`

### 3.2 Owned Scaffold Phase

When Pi's default scaffold is absent, `system-prompt` appends a package-owned `<system-reminder type="harness">` block containing the built-in tool list and package guidelines.

Required setup for ownership mode:

```md
You are an expert coding assistant operating inside pi, a coding agent harness.
```

That text should be placed in `~/.pi/agent/SYSTEM.md`. If the setup is absent and Pi's default prompt remains active, the owned scaffold no-ops.

The owned scaffold adapts to selected tools. For example, bash guidance changes depending on whether purpose-built file-discovery tools are also available.

### 3.3 Dynamic Template Phase

After scaffold ownership, `system-prompt` renders:

- global template: `<PI_CODING_AGENT_DIR>/agent.njk`
- nearest project template: `.pi/agent.njk` walking upward from cwd

Template variables include:

- provider/model/cwd/UI state
- selected tools, preferring `event.systemPromptOptions.selectedTools`
- environment variables
- `isMainAgent` / `isSubagent`, derived from `PI_SUBAGENT=1`
- optional JSON overrides for a `--debug-prompt` materialization turn

Rendered non-empty output is appended as:

```xml
<system-reminder type="rules">
<global rendered text>
</system-reminder>

<system-reminder type="project-rules">
<project rendered text>
</system-reminder>
```

Template output is trimmed aggressively so conditional whitespace does not bloat the prompt.

### 3.4 Adjacent Non-System Context

`pi-extensions/messaging/project-structure/` sends the bounded repository tree as a displayed custom message with `customType="project-structure"`. Its content remains model-visible and XML-wrapped, but it is not appended to the system prompt. The TUI renderer shows only `Project tree sent to agent`.

This is intentionally outside `system-prompt`: the project tree is volatile navigation context, not a stable operating instruction.

### 3.5 Later Prompt Contributors

Other extensions can still append to `event.systemPrompt` after `system-prompt` based on package load order. The main example is `subagent`, which appends available-agent inventory and selected-agent prompt context.

Tool metadata registered through `promptSnippet` / `promptGuidelines` is woven by Pi core separately from `before_agent_start` chaining.

## 4. Invariants

- Append to `event.systemPrompt`; do not replace unrelated prior content.
- Prefer structured `systemPromptOptions` over duplicate runtime discovery when available.
- Wrap each prompt contribution in one clear XML root.
- Keep volatile context out of the system prompt when a custom message is sufficient.
- Return early/no-op for empty contributions.
- Add `--debug-*` verification paths for new prompt-affecting behavior.

## 5. Debug Surfaces

- `--debug-prompt` — queues a synthetic `ping`, prints the materialized effective system prompt, and exits. Accepts an optional JSON object string to override template variables for that debug turn.
- `/debug-prompt` — shows the last materialized effective system prompt in the UI; warns if no turn has materialized one yet.

These surfaces inspect the system prompt only. Custom-message context such as project structure is intentionally not included.

## 6. Open Questions

- Should prompt-phase composition gain a trace view showing intermediate prompt sections?
- Should Pi expose built-in/custom `promptSnippet` and `promptGuidelines` so ownership no longer vendors tool metadata?
- Should prompt-cache-aware guidance for choosing system prompt vs custom/user message become its own package convention?

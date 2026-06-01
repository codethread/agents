# System Prompt Assembly Specification

**Status:** Implemented  
**Last Updated:** 2026-05-22

## 1. Overview

### Purpose

Document how this package contributes model-facing prompt context: Pi core discovers prompt inputs, `pi/extensions/system-prompt/` replaces the base system prompt with a package-owned rendering, and adjacent extensions contribute non-system context when that is the better cache/UX boundary.

### Goals

- Capture the ordering and boundaries for package-owned system-prompt assembly.
- Keep prompt replacement and dynamic template injection in one spec.
- Distinguish stable system-prompt instructions from volatile custom-message context.
- Define invariants for future prompt-contributing extensions.

### Non-Goals

- Redefining Pi core prompt-building behavior beyond the extension contract this package relies on.
- Specifying every line of generated prompt text.
- Documenting subagent execution or project-structure snapshot mechanics in detail; those live in their extension READMEs/tests.

## 2. Design Decisions

- **Decision:** `system-prompt` owns only stable prompt-layer behavior: full system-prompt replacement and dynamic rule templates.
  - **Rationale:** These are operating instructions that should live in the effective system prompt. Volatile context such as the project tree is better sent as custom message context so it can refresh without changing the system prompt.

- **Decision:** Dynamic template rendering runs before owned prompt building.
  - **Rationale:** The owned builder receives rendered global/project rules as one input, so it controls final ordering and formatting.

- **Decision:** The extension prefers `before_agent_start.event.systemPromptOptions.selectedTools` over rediscovering active tools.
  - **Rationale:** Pi core already resolved the selected tool set for the prompt being built. Reusing it keeps owned tool metadata and template variables aligned with the actual request.

- **Decision:** The owned builder consumes Pi's structured `systemPromptOptions` instead of parsing `event.systemPrompt`.
  - **Rationale:** Pi already exposes selected tools, tool snippets, prompt guidelines, context files, skills, cwd, and append text. Structured inputs keep ownership explicit and deterministic.

- **Decision:** Dynamic rule templates support one global template and the nearest project template.
  - **Rationale:** Personal rules and repo-local rules solve different problems. A nearest-template rule avoids ambiguous multi-template stacking.

- **Decision:** Rendered template sections are XML-wrapped by scope.
  - **Rationale:** `<system-reminder type="rules">` and `<system-reminder type="project-rules">` keep adjacent instructions from bleeding together.

- **Decision:** `--debug-prompt` synthesizes a `ping` turn, while `/debug-prompt` displays the last materialized prompt only.
  - **Rationale:** The effective prompt only exists when a turn starts. Non-interactive debug mode should force materialization and exit; interactive debug should not create surprise turns.

## 3. Architecture

Implementation lives in `pi/extensions/system-prompt/`.

### 3.1 Pi Core Foundation

Before extension hooks run, Pi core establishes `event.systemPrompt` from its base prompt inputs:

- user `SYSTEM.md` or `--system-prompt`
- context files, skills, current date, cwd
- `--append-system-prompt`
- selected tools and tool metadata surfaced through `event.systemPromptOptions`

### 3.2 Owned Prompt Replacement Phase

`system-prompt` replaces `event.systemPrompt` during `before_agent_start` with a package-owned rendering. The builder owns final ordering for identity, harness/tool guidance, dynamic rule output, project context, skills, session metadata, and append text.

The identity defaults to:

```md
You are an expert coding assistant operating inside pi, a coding agent harness.
```

If Pi supplies `systemPromptOptions.customPrompt`, the builder uses that text as the identity section instead.

Tool rendering uses `systemPromptOptions.selectedTools` and `systemPromptOptions.toolSnippets`, including custom extension tools when Pi exposes snippets for them. Guidelines are rendered under the matching tool when possible; package-owned global response guidelines remain in a short general-guidelines list. The `subagent` tool is rendered last so its nested available-agent inventory stays adjacent to the tool that uses it.

### 3.3 Dynamic Template Phase

Before owned prompt building, `system-prompt` renders:

- global template: `<PI_CODING_AGENT_DIR>/agent.njk`
- nearest project template: `.pi/agent.njk` walking upward from cwd

Template variables include:

- provider/model/cwd/UI state
- selected tools, preferring `event.systemPromptOptions.selectedTools`
- environment variables
- `isMainAgent` / `isSubagent`, derived from `PI_SUBAGENT=1`
- optional JSON overrides for a `--debug-prompt` materialization turn

Rendered non-empty output is passed into the owned prompt builder as:

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

`pi/extensions/messaging/project-structure/` sends the bounded repository tree as a displayed custom message with `customType="project-structure"`. Its content remains model-visible and XML-wrapped, but it is not appended to the system prompt. The TUI renderer shows only `Project tree sent to agent`.

This is intentionally outside `system-prompt`: the project tree is volatile navigation context, not a stable operating instruction.

### 3.5 Subagent Prompt Contribution

The `subagent` extension contributes the visible agent/swarm catalog during `before_agent_start`. Because `system-prompt` loads first, `subagent` inserts that catalog into the owned operating harness under the final `subagent` tool entry. A selected direct-agent prompt from `--agent <name>` still appends as `<system-reminder type="selected-agent-prompt">` for recency.

Tool metadata registered through `promptSnippet` / `promptGuidelines` is surfaced through Pi's `systemPromptOptions` and rendered by the owned builder.

## 4. Invariants

- Replace `event.systemPrompt` only from structured `systemPromptOptions`; do not parse Pi's generated prompt text.
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
- Should Pi expose prompt metadata grouped by tool so extensions do not need to reconstruct guideline ownership from registration order?
- Should prompt-cache-aware guidance for choosing system prompt vs custom/user message become its own package convention?

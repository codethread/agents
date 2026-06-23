# System Prompt Assembly Specification

**Document ID:** `SPEC-006`

**Status:** Implemented  
**Last Updated:** 2026-05-22
**Configuration identification:** `SPEC-006` prefixes section and point identifiers in this document. Existing human-readable numbering is preserved for migration traceability.

## SPEC-006.P1 1. Overview

### SPEC-006.P2 Purpose

Document how this package contributes model-facing prompt context: Pi core discovers prompt inputs, `pi/extensions/system-prompt/` replaces the base system prompt with a package-owned rendering, and adjacent extensions contribute non-system context when that is the better cache/UX boundary.

### SPEC-006.P3 Goals

- **SPEC-006.B1:** Capture the ordering and boundaries for package-owned system-prompt assembly.
- **SPEC-006.B2:** Keep prompt replacement and dynamic template injection in one spec.
- **SPEC-006.B3:** Distinguish stable system-prompt instructions from volatile custom-message context.
- **SPEC-006.B4:** Define invariants for future prompt-contributing extensions.

### SPEC-006.P4 Non-Goals

- **SPEC-006.B5:** Redefining Pi core prompt-building behavior beyond the extension contract this package relies on.
- **SPEC-006.B6:** Specifying every line of generated prompt text.
- **SPEC-006.B7:** Documenting subagent execution or project-structure snapshot mechanics in detail; those live in their extension READMEs/tests.

## SPEC-006.P5 2. Design Decisions

- **SPEC-006.D1 Decision:** `system-prompt` owns only stable prompt-layer behavior: full system-prompt replacement and dynamic rule templates.
  - **Rationale:** These are operating instructions that should live in the effective system prompt. Volatile context such as the project tree is better sent as custom message context so it can refresh without changing the system prompt.

- **SPEC-006.D2 Decision:** Dynamic template rendering runs before owned prompt building.
  - **Rationale:** The owned builder receives rendered global/project rules as one input, so it controls final ordering and formatting.

- **SPEC-006.D3 Decision:** The extension prefers `before_agent_start.event.systemPromptOptions.selectedTools` over rediscovering active tools.
  - **Rationale:** Pi core already resolved the selected tool set for the prompt being built. Reusing it keeps owned tool metadata and template variables aligned with the actual request.

- **SPEC-006.D4 Decision:** The owned builder consumes Pi's structured `systemPromptOptions` instead of parsing `event.systemPrompt`.
  - **Rationale:** Pi already exposes selected tools, tool snippets, prompt guidelines, context files, skills, cwd, and append text. Structured inputs keep ownership explicit and deterministic.

- **SPEC-006.D5 Decision:** Dynamic rule templates support one global template and the nearest project template.
  - **Rationale:** Personal rules and repo-local rules solve different problems. A nearest-template rule avoids ambiguous multi-template stacking.

- **SPEC-006.D6 Decision:** Rendered template sections are XML-wrapped by scope.
  - **Rationale:** `<system-reminder type="rules">` and `<system-reminder type="project-rules">` keep adjacent instructions from bleeding together.

- **SPEC-006.D7 Decision:** `--debug-prompt` synthesizes a `ping` turn, while `/debug-prompt` displays the last materialized prompt only.
  - **Rationale:** The effective prompt only exists when a turn starts. Non-interactive debug mode should force materialization and exit; interactive debug should not create surprise turns.

## SPEC-006.P6 3. Architecture

Implementation lives in `pi/extensions/system-prompt/`.

### SPEC-006.P7 3.1 Pi Core Foundation

Before extension hooks run, Pi core establishes `event.systemPrompt` from its base prompt inputs:

- **SPEC-006.B8:** user `SYSTEM.md` or `--system-prompt`
- **SPEC-006.B9:** context files, skills, current date, cwd
- **SPEC-006.B26:** `--append-system-prompt`
- **SPEC-006.B10:** selected tools and tool metadata surfaced through `event.systemPromptOptions`

### SPEC-006.P8 3.2 Owned Prompt Replacement Phase

`system-prompt` replaces `event.systemPrompt` during `before_agent_start` with a package-owned rendering. The builder owns final ordering for identity, harness/tool guidance, dynamic rule output, project context, skills, session metadata, and append text.

The identity defaults to:

```md
You are an expert coding assistant operating inside pi, a coding agent harness.
```

If Pi supplies `systemPromptOptions.customPrompt`, the builder uses that text as the identity section instead.

Tool rendering uses `systemPromptOptions.selectedTools` and `systemPromptOptions.toolSnippets`, including custom extension tools when Pi exposes snippets for them. Guidelines are rendered under the matching tool when possible; package-owned global response guidelines remain in a short general-guidelines list. The `subagent` tool is rendered last so its nested available-agent inventory stays adjacent to the tool that uses it.

### SPEC-006.P9 3.3 Dynamic Template Phase

Before owned prompt building, `system-prompt` renders:

- **SPEC-006.B11:** global template: `<PI_CODING_AGENT_DIR>/agent.njk`
- **SPEC-006.B12:** nearest project template: `.pi/agent.njk` walking upward from cwd

Template variables include:

- **SPEC-006.B13:** provider/model/cwd/UI state
- **SPEC-006.B14:** selected tools, preferring `event.systemPromptOptions.selectedTools`
- **SPEC-006.B15:** environment variables
- **SPEC-006.B27:** `isMainAgent` / `isSubagent`, derived from `PI_SUBAGENT=1`
- **SPEC-006.B16:** optional JSON overrides for a `--debug-prompt` materialization turn

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

### SPEC-006.P10 3.4 Adjacent Non-System Context

`pi/extensions/messaging/project-structure/` sends the bounded repository tree as a displayed custom message with `customType="project-structure"`. Its content remains model-visible and XML-wrapped, but it is not appended to the system prompt. The TUI renderer shows only `Project tree sent to agent`.

This is intentionally outside `system-prompt`: the project tree is volatile navigation context, not a stable operating instruction.

### SPEC-006.P11 3.5 Subagent Prompt Contribution

The `subagent` extension contributes the visible agent/swarm catalog during `before_agent_start`. Because `system-prompt` loads first, `subagent` inserts that catalog into the owned operating harness under the final `subagent` tool entry. A selected direct-agent prompt from `--agent <name>` still appends as `<system-reminder type="selected-agent-prompt">` for recency.

Tool metadata registered through `promptSnippet` / `promptGuidelines` is surfaced through Pi's `systemPromptOptions` and rendered by the owned builder.

## SPEC-006.P12 4. Invariants

- **SPEC-006.B17:** Replace `event.systemPrompt` only from structured `systemPromptOptions`; do not parse Pi's generated prompt text.
- **SPEC-006.B18:** Prefer structured `systemPromptOptions` over duplicate runtime discovery when available.
- **SPEC-006.B19:** Wrap each prompt contribution in one clear XML root.
- **SPEC-006.B20:** Keep volatile context out of the system prompt when a custom message is sufficient.
- **SPEC-006.B21:** Return early/no-op for empty contributions.
- **SPEC-006.B22:** Add `--debug-*` verification paths for new prompt-affecting behavior.

## SPEC-006.P13 5. Debug Surfaces

- **SPEC-006.B28:** `--debug-prompt` — queues a synthetic `ping`, prints the materialized effective system prompt, and exits. Accepts an optional JSON object string to override template variables for that debug turn.
- **SPEC-006.B29:** `/debug-prompt` — shows the last materialized effective system prompt in the UI; warns if no turn has materialized one yet.

These surfaces inspect the system prompt only. Custom-message context such as project structure is intentionally not included.

## SPEC-006.P14 6. Open Questions

- **SPEC-006.B23:** Should prompt-phase composition gain a trace view showing intermediate prompt sections?
- **SPEC-006.B24:** Should Pi expose prompt metadata grouped by tool so extensions do not need to reconstruct guideline ownership from registration order?
- **SPEC-006.B25:** Should prompt-cache-aware guidance for choosing system prompt vs custom/user message become its own package convention?

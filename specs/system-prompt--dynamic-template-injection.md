# Dynamic Agents Template Injection Specification

**Status:** Implemented
**Last Updated:** 2026-04-22

## 1. Overview

### Purpose

The merged `system-prompt` extension's template phase (implemented in `dynamic-agents-md/`) appends dynamically rendered prompt text to Pi's system prompt at run start. Supports a global template, a nearest project template, lightweight Nunjucks rendering, Pi-provided structured prompt inputs (notably `systemPromptOptions.selectedTools`), and the merged prompt-debug surfaces.

### Non-Goals

- Arbitrary template filenames or multiple project templates per directory level.
- Persisting rendered output between turns or sessions.
- Mutating user messages instead of the system prompt.
- Sandboxing Nunjucks beyond the small helper surface.
- Cleaning up or managing project template files; the extension only reads them.

## 2. Design Decisions

- **Decision:** Support both a global template (`<PI_CODING_AGENT_DIR>/agent.njk`) and a nearest project template (`.pi/agent.njk` walking up from cwd).
  - **Rationale:** Personal rules and repo-local rules solve different problems and often need to compose.

- **Decision:** Inject into the system prompt, not as a user message.
  - **Rationale:** These rules behave like top-level operating instructions for the agent run.

- **Decision:** Wrap each rendered section in its own `<system-reminder type="rules">` / `<system-reminder type="project-rules">` tag.
  - **Rationale:** Explicit section boundaries prevent surrounding prompt prose from bleeding across adjacent injections.

- **Decision:** Strip blank lines aggressively after rendering.
  - **Rationale:** Templates often contain conditional whitespace; stripping keeps output compact and predictable.

- **Decision:** Add `regex_test` and `has_tools` Nunjucks filters instead of custom mini-syntax.
  - **Rationale:** Templates stay flexible without a new DSL.

- **Decision:** Derive `isMainAgent`/`isSubagent` from the `PI_SUBAGENT=1` env marker set by the subagent runtime.
  - **Rationale:** Lets templates switch between user-facing guidance and terse parent-agent-facing guidance.

- **Decision:** `--debug-prompt` triggers a one-shot synthetic `ping` user message and exits after printing the prompt.
  - **Rationale:** The effective prompt only materializes when a turn starts; a forced ping is the cleanest way to capture it non-interactively.

- **Decision:** `/debug-prompt` reads the last materialized effective prompt from the current session and warns instead of synthesizing a turn when no prompt has materialized yet.
  - **Rationale:** The slash command should reflect exactly what a real turn used, not silently create a new one.

- **Decision:** `before_agent_start` should prefer `event.systemPromptOptions.selectedTools` over rediscovering active tools when populating template vars.
  - **Rationale:** Pi's prompt builder already resolved the selected tool set. Reusing it keeps template rendering aligned with the actual prompt and avoids duplicate discovery logic.

- **Decision:** `--debug-prompt` accepts a JSON object string whose keys override machine-derived template vars for that debug turn only.
  - **Rationale:** Lets operators inspect how the prompt renders under alternative model/provider/tool contexts without running the full pipeline.

- **Decision:** Non-object-shaped values after `--debug-prompt` are ignored rather than rejected.
  - **Rationale:** Preserves legacy bare-flag invocations like `pi --debug-prompt ping`.

## 3. Template Variables

The rendered template vars are assembled from runtime state plus Pi's prompt-builder inputs:

- `provider`, `model`, `cwd`, `hasUI`
- `isMainAgent` / `isSubagent`
- environment variables
- `tools`, preferring `event.systemPromptOptions.selectedTools` and falling back to runtime tool discovery only for compatibility
- optional `--debug-prompt '{...}'` JSON overrides, applied for that debug turn only
- cached last-materialized prompt text used by `/debug-prompt`

## 4. Prompt Injection Contract

When both templates render non-empty output, the injected fragment is:

```xml
<system-reminder type="rules">
<global rendered text>
</system-reminder>

<system-reminder type="project-rules">
<project rendered text>
</system-reminder>
```

When only one template renders non-empty output, that single section is still wrapped in its scope-specific tag. When both are empty, nothing is injected.

## 5. Open Questions

- Should `/debug-prompt` eventually show prompt-phase diffs in addition to the final materialized prompt?

## 7. Code Locations

- `pi-extensions/system-prompt/index.ts` — merged prompt-layer entrypoint; owns the Pi hooks, single `--debug-prompt` flag, and `/debug-prompt` command that invoke this template phase
- `pi-extensions/system-prompt/dynamic-agents-md/index.ts` — template rendering and prompt-debug helper utilities
- `pi-extensions/system-prompt/dynamic-agents-md/parser.ts` — template discovery, rendering, Nunjucks helpers

# Dynamic Agents Template Injection Specification

**Status:** Implemented
**Last Updated:** 2026-04-21

## 1. Overview

### Purpose

The `dynamic-agents-md` extension appends dynamically rendered prompt text to Pi's system prompt at run start. Supports a global template, a nearest project template, lightweight Nunjucks rendering, and two prompt-debug surfaces.

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

- **Decision:** Wrap each rendered section in its own `<system_reminder type="rules">` / `<system_reminder type="project-rules">` tag.
  - **Rationale:** Explicit section boundaries prevent surrounding prompt prose from bleeding across adjacent injections.

- **Decision:** Strip blank lines aggressively after rendering.
  - **Rationale:** Templates often contain conditional whitespace; stripping keeps output compact and predictable.

- **Decision:** Add `regex_test` and `has_tools` Nunjucks filters instead of custom mini-syntax.
  - **Rationale:** Templates stay flexible without a new DSL.

- **Decision:** Derive `isMainAgent`/`isSubagent` from the `PI_SUBAGENT=1` env marker set by the subagent runtime.
  - **Rationale:** Lets templates switch between user-facing guidance and terse parent-agent-facing guidance.

- **Decision:** `--debug-prompt` triggers a one-shot synthetic `ping` user message and exits after printing the prompt.
  - **Rationale:** The effective prompt only materializes when a turn starts; a forced ping is the cleanest way to capture it non-interactively.

- **Decision:** `--debug-prompt` accepts a JSON object string whose keys override machine-derived template vars for that debug turn only.
  - **Rationale:** Lets operators inspect how the prompt renders under alternative model/provider/tool contexts without running the full pipeline.

- **Decision:** Non-object-shaped values after `--debug-prompt` are ignored rather than rejected.
  - **Rationale:** Preserves legacy bare-flag invocations like `pi --debug-prompt ping`.

## 3. Prompt Injection Contract

When both templates render non-empty output, the injected fragment is:

```xml
<system_reminder type="rules">
<global rendered text>
</system_reminder>

<system_reminder type="project-rules">
<project rendered text>
</system_reminder>
```

When only one template renders non-empty output, that single section is still wrapped in its scope-specific tag. When both are empty, nothing is injected.

## 4. Open Questions

- Should `/debug-prompt` clean up its temp file after the editor exits?
- Should injection remain system-prompt-based long-term given prompt-cache tradeoffs noted in `specs/notes--discovery.md`?

## 5. Testing

Automated tests in `pi-extensions/dynamic-agents-md/parser.test.ts` and `index.test.ts` cover discovery, filter behavior, subagent-vs-main var derivation, blank-line stripping, merge ordering, debug-flag override parsing, and override precedence.

## 6. Code Locations

- `pi-extensions/dynamic-agents-md/` — extension entry, lifecycle hooks, debug flag + command
- `pi-extensions/dynamic-agents-md/parser.ts` — template discovery, rendering, Nunjucks helpers

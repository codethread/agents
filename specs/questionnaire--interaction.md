# Questionnaire Interaction Specification

**Status:** Implemented
**Last Updated:** 2026-04-21

## 1. Overview

### Purpose

A structured-input tool for Pi sessions that need user clarification before proceeding. Accepts one or more multiple-choice questions, renders them into a temp markdown document, opens it in `$VISUAL`/`$EDITOR`, parses the completed responses, and returns normalized structured results.

### Non-Goals

- Restoring the previous custom tabbed questionnaire UI.
- Persisting questionnaire state across sessions.
- Conditional branching or rich form schemas beyond markdown-rendered option details.
- Parsing arbitrary prose outside designated response blocks.
- Falling back to Pi's inline input editor when no external editor is configured.

## 2. Design Decisions

- **Decision:** One tool for both single- and multi-question flows.
  - **Rationale:** Callers shouldn't need separate tools when only count differs.

- **Decision:** `Other` is always included as the final choice and is no longer configurable per question.
  - **Rationale:** Clarification workflows often need an escape hatch; dropping per-question config simplifies the contract.

- **Decision:** Separate verbose option rendering (rich markdown descriptions) from compact answer parsing (checkbox list inside `<user-response>`).
  - **Rationale:** Agents can write rich option descriptions without making the parser fragile.

- **Decision:** Emit a companion `session-tldr.md` transcript alongside the questionnaire.
  - **Rationale:** Users can navigate both files via normal editor workflows; avoids embedding chat history in the questionnaire itself.

- **Decision:** Treat an empty saved buffer as explicit stop (returns `stopped: true` with a `<system-message>` telling the agent not to acknowledge).
  - **Rationale:** Clearing a buffer is often easier than finding a dedicated cancel control inside a text editor.

- **Decision:** Failures (no editor, launch error, non-zero exit, signal termination) are represented as cancelled results, not thrown tool errors.
  - **Rationale:** Callers expect a uniform result shape regardless of failure mode.

- **Decision:** Subagents hide `questionnaire` from active tools on `session_start` via the `PI_SUBAGENT=1` env marker.
  - **Rationale:** Headless subagent processes have no user to answer questions; hiding at prompt-build time is cleaner than a runtime execution guard.

- **Decision:** Validation retries rewrite the same file with a prepended `<!-- questionnaire-errors:start -->` banner; older banners are stripped before re-prepending.
  - **Rationale:** Keeps retries idempotent and the diff obvious to the user.

## 3. Parsing Contract

Per question the parser requires:

- exactly one question-marker section
- exactly one `<user-response>` block inside `### Answer:`
- exactly one checked box
- checked index within the rendered option range
- if `Other` is checked, non-empty custom text after trimming (leading `Other:` prefix is stripped)

## 4. Open Questions

- Should cancelled rendering surface the underlying reason instead of only `Cancelled`?
- Should validation errors eventually appear inline beside each question as well as in the top banner?
- Should the tool preserve the temp file for debugging after repeated failures?

## 6. Code Locations

- `pi-extensions/questionnaire/` — extension entry, editor lifecycle, rendering
- `pi-extensions/questionnaire/parser.ts` — markdown form rendering + response parsing
- `pi-extensions/shared/session-transcript.ts` — transcript extraction shared with `tldr`

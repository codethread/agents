# Extension Presentation Layer Specification

**Status:** Implemented
**Last Updated:** 2026-04-21

## 1. Overview

### Purpose

A small presentation layer on top of Pi's extension APIs: compact renderers for noisy built-in tools, a session footer with workspace/model status, shared usage-formatting helpers, and a Rose Pine Moon theme supplying the semantic colors those renderers depend on. Changes how extensions present state in the TUI; does not alter underlying tool behavior.

### Non-Goals

- Reimplementing `bash` or `read` tool execution.
- Specifying the subagent runtime (only shared presentation helpers touch it).
- Defining Pi's theme schema or TUI framework.
- Persisting usage/session metrics beyond the active session.

## 2. Design Decisions

- **Decision:** Wrap built-in `bash` and `read` tools; don't fork execution logic.
  - **Rationale:** We want custom rendering, not a forked tool implementation.

- **Decision:** Hide successful `read` output completely in the TUI.
  - **Rationale:** File contents are already visible to the model; duplicating them adds noise.

- **Decision:** Collapse bash output to 5 lines by default.
  - **Rationale:** Keeps transcripts scannable while preserving expansion.

- **Decision:** Share usage/model string formatting in one helper module (`ui/statusline/usage-format.ts`), consumed by the footer and subagent rendering.
  - **Rationale:** Context, cost, and model labels should read consistently across surfaces.

- **Decision:** Footer cost is summed from assistant messages in the active branch only.
  - **Rationale:** Reflects session-branch usage, not a global account total.

- **Decision:** Renderers request semantic theme roles (`toolTitle`, `warning`, `error`, …), never raw palette values.
  - **Rationale:** Palette changes shouldn't require touching renderer logic.

- **Decision:** Context-usage color escalates `dim` → `warning` (>70%) → `error` (>90%).
  - **Rationale:** Visible approach-of-limit warning without cluttering the normal state.

## 3. Open Questions

- Should successful `read` ever show an expanded preview, or is complete suppression the long-term contract?
- `formatContextDisplay(...)` supports `autoCompactEnabled` but the footer ignores it — should another surface consume it?

## 5. Code Locations

- `pi-extensions/tools/bash/` — compact bash renderer
- `pi-extensions/tools/read/` — compact read renderer
- `pi-extensions/ui/statusline/` — session footer + shared formatting helpers
- `pi-themes/rose-pine.json` — semantic theme roles

# Pi Extension Discovery Specification

**Status:** Implemented
**Last Updated:** 2026-04-22

## 1. Overview

### Purpose

The `pi-discovery` context-management extension tells Pi where its runtime/source tree and currently discovered extension source files live — but only when that context is likely relevant. Instead of appending a catalog to every system prompt, it watches raw user input and appends a one-shot contextual note to the first user message whose text contains the standalone, case-sensitive token `Pi`.

### Non-Goals

- Explaining extension behavior itself; the extension only points Pi at the files so it can inspect them.
- Loading or executing extension modules for discovery.
- Managing extension enable/disable state.
- Discovering skills, prompts, themes, or agents.

## 2. Design Decisions

- **Decision:** Discovery uses `DefaultPackageManager.resolve(...)` instead of manual parsing.
  - **Rationale:** Matches Pi's real extension/package discovery rules exactly — package manifests, precedence, path filters.

- **Decision:** Missing configured packages are skipped (`resolve(async () => "skip")`), never auto-installed.
  - **Rationale:** This extension is informational; it must not trigger installs as a prompt-rendering side effect.

- **Decision:** Triggers on the `input` event, not `before_agent_start`.
  - **Rationale:** `input` sees raw user text before skill/template expansion, so the note can be appended to the same user message.

- **Decision:** No unconditional system-prompt injection; only appends when the user explicitly says `Pi`.
  - **Rationale:** Avoids polluting unrelated prompts and reduces prompt-cache churn.

- **Decision:** The `Pi` trigger is case-sensitive and single-shot per extension runtime instance.
  - **Rationale:** Keeps behavior narrow and predictable. Catches explicit references, not every lowercase `pi` substring or follow-up turn. Resets on `/reload`, `/new`, `/resume`, `/fork`.

- **Decision:** A failed discovery lookup does not consume the one-shot trigger.
  - **Rationale:** Transient resolution failures shouldn't silently lose the user's signal.

- **Decision:** Injected XML is compact overall but `<pi-source>` prose stays multiline; debug form is fully multiline.
  - **Rationale:** Compact keeps unrelated turns lean; prose guidance needs structure to stay readable.

- **Decision:** Displayed XML omits `runtimePackageDir` and `runtimePackageEntry`.
  - **Rationale:** Redundant with `inspectPackageDir` and often points at store/compiled paths that tokenize poorly.

- **Decision:** Surface file paths and base directories, not behavior summaries.
  - **Rationale:** The user goal is source-code discoverability. Once Pi knows where the core package and extensions live, it can inspect directly.

## 3. Injected Note Shape

The appended `<pi-extension-discovery>` fragment contains:

- a `note` attribute telling Pi to inspect source/docs directly when relevant
- global/project config paths relevant to extension discovery
- a `<pi-source>` multiline text block with resolved docs/examples/core-tool paths
- `<available-extensions>` with one self-closing `<extension ... />` per enabled entrypoint

Extension names are derived: `.../foo/index.ts|js` → `foo`; `.../bar.ts|js` → `bar`.

## 4. Debug Surface

`/debug-extensions` formats the current discovery state as multiline XML, shows it UI-only (hidden from agent), falls back to stdout without UI.

## 6. Code Locations

- `pi-extensions/context-management/pi-discovery/index.ts` — Pi-discovery extension entrypoint; owns the `input` hook, session warm-up, and `/debug-extensions`
- `pi-extensions/context-management/pi-discovery/` — Pi-discovery implementation modules
- `pi-extensions/context-management/pi-discovery/context-note.ts` — discovery caching, contextual-note injection helpers, and debug-report formatting helpers
- `pi-extensions/context-management/pi-discovery/extension-discovery.ts` — `DefaultPackageManager`-backed discovery

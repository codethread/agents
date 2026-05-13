# System Prompt Ownership

**Status:** Implemented  
**Last Updated:** 2026-04-22

## 1. Overview

### Purpose

Own Pi's base prompt scaffold — the tool list and guideline sections — as the first prompt phase inside the merged `system-prompt` extension, while preserving normal `before_agent_start` chaining so that later behaviors like template injection and `subagent` can continue appending to the owned prompt without modification. The owned scaffold itself is wrapped in one `<system-reminder type="harness">` block so later injected prose stays clearly separated. The tool inventory should come from Pi's structured selected-tool set (`event.systemPromptOptions.selectedTools`) when available.

### Goals

- Replace Pi's default tool/guideline sections with a controlled, package-owned version.
- Detect the default Pi base prompt and skip ownership when it is still present, preventing duplicate sections.
- Adapt guidelines dynamically to the active tool set (e.g. different bash guidance when `grep`/`find`/`ls` are also active).
- Keep owned-scaffold verification inside the merged prompt-debug surfaces rather than separate behavior-specific flags.

### Non-Goals

- Reconstructing `promptSnippet` / `promptGuidelines` for custom extension tools (Pi does not expose this metadata publicly).
- Replacing Pi's internal prompt builder or forking Pi core.
- Owning context files, skills, current date, or cwd injection — Pi core handles these when features are not disabled.

## 2. Design Decisions

- **Decision:** Detect the default Pi base prompt via a sentinel string (`"Pi documentation (read only when…)"`) rather than comparing the full prompt text.
  - **Rationale:** The sentinel is stable and unique to Pi's default base prompt. A full-text comparison would be fragile; an empty/missing check would fail when a user hasn't set up `SYSTEM.md`.

- **Decision:** Do nothing when the default Pi prompt is still present rather than erroring or replacing it.
  - **Rationale:** Graceful degradation means the extension is safe to load even before the user has created `~/.pi/agent/SYSTEM.md`. It becomes active only after setup.

- **Decision:** Manually vendor built-in tool `promptSnippet` / `promptGuidelines` rather than reading them from Pi's runtime API.
  - **Rationale:** `pi.getAllTools()` does not expose `promptSnippet` or `promptGuidelines` for any tool — built-in or custom. Built-in metadata is available from Pi's public exports and source files and is stable across minor versions. Manual sync on Pi upgrades is cheap.

- **Decision:** Synthesize the bash guideline conditionally based on whether `grep`, `find`, or `ls` are also active.
  - **Rationale:** When those tools are absent, `bash` is the only file exploration option and the guideline should say so. When they are present, users should prefer the purpose-built tools.

- **Decision:** Prefer `event.systemPromptOptions.selectedTools` over rediscovering active tools when building the owned scaffold.
  - **Rationale:** Pi's prompt builder already knows which tools are selected for the prompt. Reusing that structured input keeps the owned tool list and guidelines aligned with the actual prompt being assembled.

- **Decision:** This behavior must run first inside the merged `system-prompt` entrypoint, and that merged extension must be listed before later prompt-contributing extensions such as `subagent`.
  - **Rationale:** The owned scaffold needs to establish the base prompt shape before later appenders chain from it.

- **Decision:** Owned-scaffold verification should flow through the merged `--debug-prompt` / `/debug-prompt` surfaces rather than a dedicated ownership-only flag.
  - **Rationale:** Users only need one way to inspect the final prompt, and the owned scaffold is meaningful only as part of that assembled whole.

## 3. Required Setup

Users must create `~/.pi/agent/SYSTEM.md` containing:

```
You are an expert coding assistant operating inside pi, a coding agent harness.
```

Pi core treats this as the custom base prompt and still appends context files, skills, current date, and cwd. The extension then appends the owned tool/guideline sections via `before_agent_start`, wrapped in `<system-reminder type="harness">`.

If the file is absent or the default Pi base prompt is still in effect, the extension silently skips appending (see sentinel detection above).

## 4. Refreshing Built-in Tool Metadata

Built-in tool strings are manually synced from Pi. On Pi upgrades, re-check:

```
$PI_PACKAGE_DIR/dist/core/tools/{read,bash,edit,write,grep,find,ls}.js
```

If `PI_PACKAGE_DIR` is unset, resolve the path via `import.meta.resolve("@earendil-works/pi-coding-agent")`.

## 5. Open Questions

- Should the owned prompt include `promptSnippet` / `promptGuidelines` for custom extension tools (e.g. `subagent`) once Pi exposes that metadata publicly? Likely yes — `subagent` is the strongest candidate since its snippet is semantically important.

## 7. Code Locations

- `pi-extensions/system-prompt/index.ts` — merged prompt-layer entrypoint; owns the Pi hooks plus the merged prompt-debug surfaces that expose this behavior first
- `pi-extensions/system-prompt/owned-system-prompt/` — ownership prompt-building helpers, tests, README

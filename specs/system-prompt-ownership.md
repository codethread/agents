# System Prompt Ownership

**Status:** Implemented  
**Last Updated:** 2026-04-18

## 1. Overview

### Purpose

Own Pi's base prompt scaffold — the tool list and guideline sections — while preserving normal `before_agent_start` chaining so that later extensions like `dynamic-agents-md` and `subagent` can continue appending to the owned prompt without modification. The owned scaffold itself is wrapped in one `<system_reminder type="harness">` block so later injected prose stays clearly separated.

### Goals

- Replace Pi's default tool/guideline sections with a controlled, package-owned version.
- Detect the default Pi base prompt and skip ownership when it is still present, preventing duplicate sections.
- Adapt guidelines dynamically to the active tool set (e.g. different bash guidance when `grep`/`find`/`ls` are also active).
- Expose a `--debug-owned-prompt` flag for verifying the final effective prompt.

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

- **Decision:** This extension must be listed first in `package.json#pi.extensions`.
  - **Rationale:** `before_agent_start` callbacks run in extension load order. A later replacement clobbers earlier mutations, so the ownership extension must run before other prompt-mutating extensions to produce a clean prompt shape.

- **Decision:** Debug flag triggers a `ping` turn via `pi.sendUserMessage("ping")` rather than reading the prompt synchronously at `session_start`.
  - **Rationale:** The system prompt is only materialized when a turn starts (`agent_start`). Reading it at `session_start` gives an incomplete view.

## 3. Architecture

The extension is a single `before_agent_start` hook with three exported pure functions used in tests:

- `getOwnedBuiltinTools(activeTools)` — filters active tools to known built-ins in deterministic order.
- `buildOwnedGuidelines(activeTools)` — assembles the guideline list, adapting bash guidance to the active tool set.
- `buildOwnedPromptAddon(activeTools)` — renders the full `Available tools` + `Guidelines` block inside `<system_reminder type="harness">`.
- `shouldAppendOwnedPrompt(systemPrompt)` — returns `false` when the Pi default sentinel is present.

See `pi-extensions/extensions/owned-system-prompt/index.ts`.

## 4. Required Setup

Users must create `~/.pi/agent/SYSTEM.md` containing:

```
You are an expert coding assistant operating inside pi, a coding agent harness.
```

Pi core treats this as the custom base prompt and still appends context files, skills, current date, and cwd. The extension then appends the owned tool/guideline sections via `before_agent_start`, wrapped in `<system_reminder type="harness">`.

If the file is absent or the default Pi base prompt is still in effect, the extension silently skips appending (see sentinel detection above).

## 5. Refreshing Built-in Tool Metadata

Built-in tool strings are manually synced from Pi. On Pi upgrades, re-check:

```
$PI_PACKAGE_DIR/dist/core/tools/{read,bash,edit,write,grep,find,ls}.js
```

If `PI_PACKAGE_DIR` is unset, resolve the path via `import.meta.resolve("@mariozechner/pi-coding-agent")`.

## 6. Testing

Automated tests in:

- `pi-extensions/extensions/owned-system-prompt/index.test.ts` — unit tests for helper functions and the full extension lifecycle (sentinel detection, prompt assembly, debug-flag flow, no-op when default prompt is active).

## 7. Code Locations

| File                                                         | Role                                           |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `pi-extensions/extensions/owned-system-prompt/index.ts`      | Extension entry point and all exported helpers |
| `pi-extensions/extensions/owned-system-prompt/index.test.ts` | Unit and integration tests                     |
| `pi-extensions/extensions/owned-system-prompt/README.md`     | User setup instructions and debug flag docs    |

## 8. Open Questions

- Should the owned prompt include `promptSnippet` / `promptGuidelines` for custom extension tools (e.g. `subagent`) once Pi exposes that metadata publicly? Likely yes — `subagent` is the strongest candidate since its snippet is semantically important.

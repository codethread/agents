# Prompt History Specification

**Document ID:** `SPEC-002`

**Status:** Implemented
**Last Updated:** 2026-06-04
**Configuration identification:** `SPEC-002` prefixes section and point identifiers in this document. Existing human-readable numbering is preserved for migration traceability.

## SPEC-002.P1 1. Overview

### SPEC-002.P2 Purpose

Prompt history provides shell-like recall for previously submitted Pi user prompts across restarts, sessions, and linked git worktrees. The extension records submitted user prompt text in an append-only XDG cache JSONL file, tags each record with both exact cwd and canonical git repo identity, and exposes keyboard shortcuts for repo-scoped and global recall while leaving `Up` on Pi's built-in editor history.

### SPEC-002.P3 Goals

- **SPEC-002.B1:** Record submitted user prompt text while Pi is running inside a git repository.
- **SPEC-002.B2:** Preserve enough location context to distinguish exact cwd history from shared repo/worktree history.
- **SPEC-002.B3:** Recall prompts without parsing Pi session files or depending on current-session editor history.
- **SPEC-002.B4:** Keep normal sessions cheap: append on submitted user messages, but do not scan history unless the user presses a recall shortcut.
- **SPEC-002.B5:** Insert recalled prompts into the editor without auto-submitting them.
- **SPEC-002.B6:** Provide a debug flag that surfaces cache path, append behavior, selected scope, load counts, and selected index.

### SPEC-002.P4 Non-Goals

- **SPEC-002.B7:** Recording prompts outside git repositories.
- **SPEC-002.B8:** Reconstructing full Pi sessions or assistant/tool history.
- **SPEC-002.B9:** Deduplicating repeated prompts.
- **SPEC-002.B10:** Auto-submitting recalled prompts.
- **SPEC-002.B11:** Recovering malformed JSONL as a first-class behavior.
- **SPEC-002.B12:** Persisting non-text user content such as images.

## SPEC-002.P5 2. Design Decisions

- **SPEC-002.D1 Decision:** Store prompt history in an append-only JSONL file under XDG cache: `${XDG_CACHE_HOME:-~/.cache}/pi/messages.jsonl`.
  - **Rationale:** The history is user-local runtime cache, not project state or durable documentation. JSONL keeps writes simple and append-only while allowing future line-by-line lazy reads.

- **SPEC-002.D2 Decision:** Implement storage and filtering in TypeScript rather than shelling out to `jq`.
  - **Rationale:** Shortcut handling is interactive and should avoid process startup, shell quoting, and external command dependencies. Node JSON parsing is sufficient, and TypeScript can lazily read only what recall needs.

- **SPEC-002.D3 Decision:** Do not read the history file during ordinary sessions unless recall is used.
  - **Rationale:** Most sessions will never touch prompt recall. The extension should append cheap records as prompts are submitted and defer all scan/filter work until the user presses a recall shortcut.

- **SPEC-002.D4 Decision:** Record only when the current directory is inside a git work tree.
  - **Rationale:** The feature's useful scopes depend on git repo identity and worktree sharing. In non-git directories, recording ambiguous global-only data would be surprising; recall should instead show a non-fatal notification that prompt history is unavailable outside git repositories.

- **SPEC-002.D5 Decision:** Store exact `cwd` separately from canonical `repoRoot`.
  - **Rationale:** Users may launch Pi from nested monorepo subdirectories where exact cwd history matters, while also wanting shared history across worktrees of the same canonical repository.

- **SPEC-002.D6 Decision:** Derive canonical `repoRoot` from `git rev-parse --path-format=absolute --git-common-dir`.
  - **Rationale:** In linked worktrees, the common git dir points back to the main repository's git storage, giving a stable identity shared by all worktrees. When it resolves to `<repo>/.git`, store `<repo>` as the canonical repo root.

- **SPEC-002.D7 Decision:** Recall scopes are mapped to keyboard shortcuts: `ctrl+p` for repo root and `ctrl+shift+p` for global.
  - **Rationale:** `ctrl+p` covers the common cross-worktree repo retry flow, `ctrl+shift+p` provides an explicit broad escape hatch, and `Up` stays on Pi's built-in editor history.

- **SPEC-002.D8 Decision:** Recall inserts text into the editor and never sends it automatically.
  - **Rationale:** Recalled prompts may need editing after an environment fix or context change. Auto-submit would make accidental sends too easy.

- **SPEC-002.D9 Decision:** Do not deduplicate records.
  - **Rationale:** The simplest mental model is that recall walks what was actually submitted. If a prompt was retried multiple times, the history should reflect that rather than applying hidden cleverness.

- **SPEC-002.D10 Decision:** Load at most 100 matching records for an interactive recall buffer.
  - **Rationale:** A small cap keeps shortcut response predictable while covering normal recent-history use. The append-only file may grow very large, so recall must stop once it has enough relevant entries.

- **SPEC-002.D11 Decision:** Test Markdown prompt round-tripping through JSONL encoding/decoding.
  - **Rationale:** User prompts are often Markdown-heavy, with code fences, quotes, XML-ish tags, backticks, and multiline content. Lossless storage of prompt text is more important than malformed-file tolerance for the first implementation.

## SPEC-002.P6 3. Architecture

### SPEC-002.P7 Component structure

```text
pi/extensions/ui/prompt-history/
|-- index.ts                 # Extension entrypoint, shortcut/event registration, debug flag
|-- history.ts               # Storage path, append, lazy read/filter, JSONL encode/decode
|-- git.ts                   # Git worktree detection and canonical repo-root resolution
|-- history.test.ts          # Storage, filtering, ordering, Markdown round-trip tests
|-- git.test.ts              # Git output parsing tests
`-- README.md                # Usage, keybinding setup, debug flag
```

Update package extension indexes and shell wrapper support:

- **SPEC-002.B27:** `pi/extensions/README.md` — list prompt-history under UI extensions.
- **SPEC-002.B28:** `scripts/pi.nu` — add `--debug-prompt-history` under extension flags.

### SPEC-002.P8 Data flow

1. Extension loads and registers:
   - `--debug-prompt-history`
   - `ctrl+p` shortcut for repo-root recall
   - `ctrl+shift+p` shortcut for global recall
   - user-message recording hook
2. When a user message is submitted:
   - resolve exact `ctx.cwd`
   - check whether it is inside a git work tree
   - derive canonical `repoRoot`
   - append one JSONL record to the cache file
3. When a recall shortcut is pressed:
   - ensure the current cwd is inside a git work tree; otherwise notify and do nothing
   - lazily load up to 100 newest matching records for the requested scope
   - cycle through the in-memory scope buffer on repeated presses
   - call `ctx.ui.setEditorText(record.message)` for the selected record

## SPEC-002.P9 4. Data Model

### SPEC-002.P10 Prompt history record

Records are written as one JSON object per line.

```json
{
	"version": 1,
	"timestamp": 1791139200000,
	"message": "User prompt text, possibly multiline Markdown",
	"cwd": "/path/to/worktree/apps/frontend",
	"repoRoot": "/path/to/canonical/repo"
}
```

Contract notes:

- **SPEC-002.B29:** `timestamp` is epoch milliseconds.
- **SPEC-002.B30:** `message` must round-trip exactly through JSON string encoding.
- **SPEC-002.B31:** `cwd` is the exact Pi cwd, not normalized to repo root.
- **SPEC-002.B32:** `repoRoot` is the canonical repository root shared across linked worktrees.

## SPEC-002.P11 5. Interfaces

### SPEC-002.P12 Keyboard shortcuts

| Shortcut       | Scope                  | Behavior                                                                                        |
| -------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `Up`           | Current editor history | Pi built-in `tui.editor.cursorUp` recalls prior prompt text in the current editor history flow. |
| `Ctrl+P`       | Repo root              | Extension recalls prompts from the same canonical repository.                                   |
| `Ctrl+Shift+P` | Global                 | Extension recalls all recorded prompts, newest-first.                                           |

These behaviors require moving conflicting built-in `Ctrl+P` / `Ctrl+Shift+P` bindings in `~/.pi/agent/keybindings.json`, including Pi's default model cycling and any other built-in surfaces that still claim those keys.

Example direction:

```json
{
	"app.model.cycleForward": "ctrl+alt+p",
	"app.model.cycleBackward": "ctrl+shift+alt+p"
}
```

### SPEC-002.P13 CLI flag

| Flag                     | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `--debug-prompt-history` | Print prompt-history diagnostics: cache path, append decisions, scope loads. |

## SPEC-002.P14 6. Implementation Phases

### SPEC-002.P15 Phase 1: Storage and git identity

- **SPEC-002.B13:** [ ] Add prompt-history extension directory and README.
- **SPEC-002.B14:** [ ] Resolve XDG cache path and create the parent directory when appending.
- **SPEC-002.B15:** [ ] Implement git worktree detection and canonical repo-root parsing from git common-dir output.
- **SPEC-002.B16:** [ ] Append one record for submitted user messages only when inside a git repository.
- **SPEC-002.B17:** [ ] Add tests for record encoding/decoding, Markdown round-trip, and git output parsing.

### SPEC-002.P16 Phase 2: Lazy recall

- **SPEC-002.B18:** [ ] Implement lazy newest-first history loading with a 100 matching record cap.
- **SPEC-002.B19:** [ ] Implement exact-cwd, repo-root, and global filters.
- **SPEC-002.B20:** [ ] Register `ctrl+p` and `ctrl+shift+p` shortcuts; leave `Up` on Pi's built-in editor history.
- **SPEC-002.B21:** [ ] Insert selected prompt into the editor with `ctx.ui.setEditorText()`.
- **SPEC-002.B22:** [ ] Show a non-fatal notification when recall is used outside a git repository.

### SPEC-002.P17 Phase 3: Integration surfaces

- **SPEC-002.B23:** [ ] Register `--debug-prompt-history`.
- **SPEC-002.B24:** [ ] Update `pi/extensions/README.md`.
- **SPEC-002.B25:** [ ] Update `scripts/pi.nu` with the extension flag.
- **SPEC-002.B26:** [ ] Run relevant tests and typecheck.

## SPEC-002.P18 7. Code Locations

| File                               | Change                                   |
| ---------------------------------- | ---------------------------------------- |
| `pi/extensions/ui/prompt-history/` | New prompt-history extension.            |
| `pi/extensions/README.md`          | Add extension index entry.               |
| `scripts/pi.nu`                    | Add `--debug-prompt-history` flag.       |
| `devflow/specs/prompt-history.md`  | Implemented spec for the feature.        |
| `devflow/README.md`                | Register this spec in the devflow index. |

## SPEC-002.P19 8. Open Questions

None.

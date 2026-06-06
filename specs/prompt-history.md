# Prompt History Specification

**Status:** Planned
**Last Updated:** 2026-06-04

## 1. Overview

### Purpose

Prompt history provides shell-like recall for previously submitted Pi user prompts across restarts, sessions, and linked git worktrees. It records submitted user messages in an append-only XDG cache JSONL file with both exact cwd and canonical git repo-root metadata, then exposes keyboard shortcuts for cwd-scoped, repo-scoped, and global recall.

### Goals

- Record every submitted user prompt while Pi is running inside a git repository.
- Preserve enough location context to distinguish exact cwd history from shared repo/worktree history.
- Recall prompts without parsing Pi session files or depending on current-session editor history.
- Keep normal sessions cheap: append on submitted user messages, but do not scan history unless the user presses a recall shortcut.
- Insert recalled prompts into the editor without auto-submitting them.
- Provide a debug flag that surfaces cache path, append behavior, selected scope, load counts, and selected index.

### Non-Goals

- Recording prompts outside git repositories.
- Reconstructing assistant/tool history or full Pi sessions.
- Deduplicating repeated prompts; raw append order is the behavior.
- Auto-submitting recalled prompts.
- Supporting malformed JSONL as a first-class recovery path.
- Replacing Pi's `/resume`, `/tree`, `/fork`, or session storage features.

## 2. Design Decisions

- **Decision:** Store prompt history in an append-only JSONL file under XDG cache: `${XDG_CACHE_HOME:-~/.cache}/pi/messages.jsonl`.
  - **Rationale:** The history is user-local runtime cache, not project state or durable documentation. JSONL keeps writes simple and append-only while allowing future line-by-line lazy reads.

- **Decision:** Implement storage and filtering in TypeScript rather than shelling out to `jq`.
  - **Rationale:** Shortcut handling is interactive and should avoid process startup, shell quoting, and external command dependencies. Node JSON parsing is sufficient, and TypeScript can lazily read only what recall needs.

- **Decision:** Do not read the history file during ordinary sessions unless recall is used.
  - **Rationale:** Most sessions will never touch prompt recall. The extension should append cheap records as prompts are submitted and defer all scan/filter work until the user presses a recall shortcut.

- **Decision:** Record only when the current directory is inside a git work tree.
  - **Rationale:** The feature's useful scopes depend on git repo identity and worktree sharing. In non-git directories, recording ambiguous global-only data would be surprising; recall should instead show a non-fatal notification that prompt history is unavailable outside git repositories.

- **Decision:** Store exact `cwd` separately from canonical `repoRoot`.
  - **Rationale:** Users may launch Pi from nested monorepo subdirectories where exact cwd history matters, while also wanting shared history across worktrees of the same canonical repository.

- **Decision:** Derive canonical `repoRoot` from `git rev-parse --path-format=absolute --git-common-dir`.
  - **Rationale:** In linked worktrees, the common git dir points back to the main repository's git storage, giving a stable identity shared by all worktrees. When it resolves to `<repo>/.git`, store `<repo>` as the canonical repo root.

- **Decision:** Recall scopes are mapped to keyboard shortcuts: `up` for exact cwd, `ctrl+p` for repo root, and `ctrl+shift+p` for global.
  - **Rationale:** `up` preserves shell-like local history semantics, `ctrl+p` covers the common cross-worktree repo retry flow, and `ctrl+shift+p` provides an explicit broad escape hatch.

- **Decision:** Recall inserts text into the editor and never sends it automatically.
  - **Rationale:** Recalled prompts may need editing after an environment fix or context change. Auto-submit would make accidental sends too easy.

- **Decision:** Do not deduplicate records.
  - **Rationale:** The simplest mental model is that recall walks what was actually submitted. If a prompt was retried multiple times, the history should reflect that rather than applying hidden cleverness.

- **Decision:** Load at most 100 matching records for an interactive recall buffer.
  - **Rationale:** A small cap keeps shortcut response predictable while covering normal recent-history use. The append-only file may grow very large, so recall must stop once it has enough relevant entries.

- **Decision:** Test Markdown prompt round-tripping through JSONL encoding/decoding.
  - **Rationale:** User prompts are often Markdown-heavy, with code fences, quotes, XML-ish tags, backticks, and multiline content. Lossless storage of prompt text is more important than malformed-file tolerance for the first implementation.

## 3. Architecture

### Component structure

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

- `pi/extensions/README.md` — list prompt-history under UI extensions.
- `scripts/pi.nu` — add `--debug-prompt-history` under extension flags.

### Data flow

1. Extension loads and registers:
   - `--debug-prompt-history`
   - `up` shortcut for exact cwd recall
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

## 4. Data Model

### Prompt history record

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

- `timestamp` is epoch milliseconds.
- `message` must round-trip exactly through JSON string encoding.
- `cwd` is the exact Pi cwd, not normalized to repo root.
- `repoRoot` is the canonical repository root shared across linked worktrees.

## 5. Interfaces

### Keyboard shortcuts

| Shortcut       | Scope     | Behavior                                           |
| -------------- | --------- | -------------------------------------------------- |
| `up`           | Exact cwd | Recall prompts submitted from the same exact cwd.  |
| `ctrl+p`       | Repo root | Recall prompts from the same canonical repository. |
| `ctrl+shift+p` | Global    | Recall all recorded prompts, newest-first.         |

These extension shortcuts require moving/unbinding conflicting built-in keybindings in `~/.pi/agent/keybindings.json`. At minimum, move model cycling away from `ctrl+p` and `ctrl+shift+p`; if `up` remains bound to `tui.editor.cursorUp`, the desired replacement behavior may also require unbinding or remapping that built-in editor action.

Example direction:

```json
{
	"app.model.cycleForward": "ctrl+alt+p",
	"app.model.cycleBackward": "ctrl+shift+alt+p"
}
```

### CLI flag

| Flag                     | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `--debug-prompt-history` | Print prompt-history diagnostics: cache path, append decisions, scope loads. |

## 6. Implementation Phases

### Phase 1: Storage and git identity

- [ ] Add prompt-history extension directory and README.
- [ ] Resolve XDG cache path and create the parent directory when appending.
- [ ] Implement git worktree detection and canonical repo-root parsing from git common-dir output.
- [ ] Append one record for submitted user messages only when inside a git repository.
- [ ] Add tests for record encoding/decoding, Markdown round-trip, and git output parsing.

### Phase 2: Lazy recall

- [ ] Implement lazy newest-first history loading with a 100 matching record cap.
- [ ] Implement exact-cwd, repo-root, and global filters.
- [ ] Register `up`, `ctrl+p`, and `ctrl+shift+p` shortcuts.
- [ ] Insert selected prompt into the editor with `ctx.ui.setEditorText()`.
- [ ] Show a non-fatal notification when recall is used outside a git repository.

### Phase 3: Integration surfaces

- [ ] Register `--debug-prompt-history`.
- [ ] Update `pi/extensions/README.md`.
- [ ] Update `scripts/pi.nu` with the extension flag.
- [ ] Run relevant tests and typecheck.

## 7. Code Locations

| File                               | Change                                |
| ---------------------------------- | ------------------------------------- |
| `pi/extensions/ui/prompt-history/` | New prompt-history extension.         |
| `pi/extensions/README.md`          | Add extension index entry.            |
| `scripts/pi.nu`                    | Add `--debug-prompt-history` flag.    |
| `specs/prompt-history.md`          | Planning spec for the feature.        |
| `specs/README.md`                  | Register this spec in the spec index. |

## 8. Open Questions

None.

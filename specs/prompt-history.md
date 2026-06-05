# Prompt History Specification

**Status:** Implemented
**Last Updated:** 2026-06-04

## 1. Overview

### Purpose

Prompt history provides shell-like recall for previously submitted Pi user prompts across restarts, sessions, and linked git worktrees. The extension records submitted user prompt text in an append-only XDG cache JSONL file, tags each record with both exact cwd and canonical git repo identity, and exposes keyboard shortcuts for repo-scoped and global recall while leaving `Up` on Pi's built-in editor history.

### Goals

- Record submitted user prompt text while Pi is running inside a git repository.
- Preserve exact cwd metadata for filtering/storage and shared cross-worktree repo history for recall.
- Keep normal sessions cheap by appending on submit and scanning only on recall.
- Recall prompts into the editor without auto-submitting them.
- Provide a debug flag for append/recall diagnostics.

### Non-Goals

- Recording prompts outside git repositories.
- Reconstructing full Pi sessions or assistant/tool history.
- Deduplicating repeated prompts.
- Auto-submitting recalled prompts.
- Recovering malformed JSONL as a first-class behavior.
- Persisting non-text user content such as images.

## 2. Design Decisions

- **Decision:** Store history in `${XDG_CACHE_HOME:-~/.cache}/pi/messages.jsonl` as append-only JSONL.
  - **Rationale:** Prompt history is user-local runtime cache, not project state. JSONL keeps writes simple and allows bounded reverse scans later.

- **Decision:** Record only when the current cwd is inside a git work tree.
  - **Rationale:** The useful recall scopes depend on git identity. Recording global-only non-git prompts would be surprising and weaken the feature boundary.

- **Decision:** Store exact `cwd` separately from canonical `repoRoot`.
  - **Rationale:** Users often want both narrow subdirectory recall and shared history across linked worktrees of the same repository.

- **Decision:** Derive canonical `repoRoot` from `git rev-parse --path-format=absolute --git-common-dir`.
  - **Rationale:** In linked worktrees the common git dir gives one stable identity shared by every worktree.

- **Decision:** Keep recall lazy and bounded to 100 newest matches.
  - **Rationale:** Most sessions will never use recall, and the history file may grow large over time.

- **Decision:** Recall inserts text into the editor and never submits it.
  - **Rationale:** Recalled prompts are usually a starting point for retry or editing, not an instruction to send immediately.

- **Decision:** Persist only text content from user messages; when a message contains multiple text parts, join them with blank lines.
  - **Rationale:** Prompt recall is a text feature, but collapsing adjacent text parts with no separator loses user-visible structure.

## 3. Architecture

Implementation lives in `pi/extensions/ui/prompt-history/`.

- `index.ts` registers the debug flag, two extension shortcuts, and the message/session hooks.
- `history.ts` owns cache-path resolution, JSONL append, reverse scanning, and scope filtering.
- `git.ts` detects whether the cwd is inside git and resolves the canonical repo root.

Flow:

1. On `message_end`, extract user prompt text.
2. Resolve git context for the current cwd.
3. Append one JSONL record with `timestamp`, `message`, `cwd`, and `repoRoot`.
4. On `Ctrl+P` or `Ctrl+Shift+P`, load up to 100 newest matching records for the requested scope.
5. Insert the selected prompt into the editor with `ctx.ui.setEditorText()`.
6. Leave `Up` bound to Pi's built-in `tui.editor.cursorUp`, which already recalls editor prompt history without extension shortcut registration.

## 4. Data Model

Each line in the cache file is one JSON object:

```json
{
	"version": 1,
	"timestamp": 1791139200000,
	"message": "User prompt text, possibly multiline Markdown",
	"cwd": "/path/to/worktree/apps/frontend",
	"repoRoot": "/path/to/canonical/repo"
}
```

Notes:

- `timestamp` is epoch milliseconds.
- `message` stores recalled text content only.
- `cwd` is the exact Pi cwd.
- `repoRoot` is the canonical repository identity shared across linked worktrees.

## 5. Interfaces

### Keyboard shortcuts

| Shortcut       | Scope                  | Behavior                                                                                        |
| -------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `Up`           | Current editor history | Pi built-in `tui.editor.cursorUp` recalls prior prompt text in the current editor history flow. |
| `Ctrl+P`       | Repo root              | Extension recalls prompts from the same canonical repository.                                   |
| `Ctrl+Shift+P` | Global                 | Extension recalls all recorded prompts, newest-first.                                           |

These behaviors require moving conflicting built-in `Ctrl+P` / `Ctrl+Shift+P` bindings in `~/.pi/agent/keybindings.json`, including Pi's default model cycling and any other built-in surfaces that still claim those keys.

### CLI flag

| Flag                     | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `--debug-prompt-history` | Print prompt-history diagnostics: cache path, append decisions, scope loads. |

## 6. Testing

Automated tests live in:

- `pi/extensions/ui/prompt-history/history.test.ts` — JSONL round-trip, scope filtering, newest-first loading, and 100-record cap
- `pi/extensions/ui/prompt-history/git.test.ts` — canonical repo-root parsing
- `pi/extensions/ui/prompt-history/index.test.ts` — extension registration, recording, repo/global recall cycling, cache invalidation, and outside-git behavior

Manual verification uses the extension's debug flag plus Pi with a local `~/.pi/agent/keybindings.json` override that moves model cycling off `Ctrl+P` / `Ctrl+Shift+P`.

## 7. Code Locations

| File                               | Change                                |
| ---------------------------------- | ------------------------------------- |
| `pi/extensions/ui/prompt-history/` | New prompt-history extension.         |
| `pi/extensions/README.md`          | Add extension index entry.            |
| `scripts/pi.nu`                    | Add `--debug-prompt-history` flag.    |
| `specs/prompt-history.md`          | Implemented spec for the feature.     |
| `specs/README.md`                  | Register this spec in the spec index. |
| `README.md`                        | Document prompt-history availability. |

## 8. Open Questions

None.

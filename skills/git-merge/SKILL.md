---
name: git-merge
description: >
  Squash-merges a local branch or linked git worktree into the branch currently checked out
  in this repository, then removes the merged worktree (if any) and deletes the merged local
  branch. Use when the user says "merge <branch>", "merge this worktree", "squash merge and
  clean up", or asks to fold a feature branch/worktree into the current trunk branch.
---

# merge

## Variables

| Variable               | Value                                                                | Notes                                                          |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| CURRENT_BRANCH         | Branch checked out in the invocation worktree                        | Merge destination; often `main`                                |
| SOURCE_INPUT           | User-supplied branch name or linked worktree                         | Exactly one source is required                                 |
| WORKTREE_LIST_CMD      | `git worktree list --porcelain`                                      | Source of truth for linked worktree metadata                   |
| GIT_OPERATION_FILES    | `MERGE_HEAD, REBASE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD, BISECT_LOG` | Files that indicate an in-progress git operation               |
| MERGE_BASE             | `git merge-base <current-branch> <source>`                           | Start of the source-only commit range                          |
| SOURCE_COMMIT_RANGE    | `<merge-base>..<source-branch>`                                      | Commits to preserve in the squash commit body                  |
| COMMIT_MESSAGE_SECTION | `Squashed commits:`                                                  | Heading for the preserved source commit log in the commit body |

## Prerequisites

- Current directory is inside a git worktree on a named branch
- `SOURCE_INPUT` resolves to exactly one local source branch
- `CURRENT_BRANCH` is different from the source branch
- Current worktree has no uncommitted, unstaged, staged, or untracked changes
- If the source branch is attached to a linked worktree, that worktree also has no uncommitted, unstaged, staged, or untracked changes
- No merge, rebase, cherry-pick, revert, or bisect is in progress in either inspected worktree

## Knowledge

### Source resolution

- First try to resolve `SOURCE_INPUT` as a worktree path by normalising it with `realpath` and matching it against `WORKTREE_LIST_CMD` output.
- When `SOURCE_INPUT` resolves to a worktree path, derive the branch from the adjacent `branch refs/heads/<name>` entry in the porcelain output.
- Otherwise resolve `SOURCE_INPUT` as a local branch with `git show-ref --verify --quiet refs/heads/<name>`.
- When `SOURCE_INPUT` is a branch name, still scan `WORKTREE_LIST_CMD` output for a linked worktree on that branch so it can be validated and removed during cleanup.

### Cleanliness rules

A worktree is clean only when both of the following are true:

- `git status --porcelain` returns no output
- No in-progress operation files from `GIT_OPERATION_FILES` exist

### Source commit range

- Compute `MERGE_BASE` with `git merge-base <current-branch> <source-branch>`.
- Compute `SOURCE_COMMIT_RANGE` as `<merge-base>..<source-branch>`.
- Capture the source-only history with `git log --reverse --format='- [%h] %s' <merge-base>..<source-branch>` so the squash body preserves a concise chronological list of source commits.
- The preserved body should be a compact reference list, not the full verbose git log output.

### Squash commit message construction

- The squash commit subject must be a semantic/conventional-style summary inferred from the commits in `SOURCE_COMMIT_RANGE`, not a generic `Squash merge ...` message.
- Infer the subject prefix from the strongest signal in the source history, preferring user-visible change types such as `feat`, `fix`, or `perf` over lower-signal maintenance types such as `chore`, `docs`, or `test` when the branch clearly contains product changes.
- If the source history consistently uses another repo-appropriate semantic prefix such as `task`, preserve that convention.
- Infer the summary text from the dominant theme across the source commit subjects and bodies; keep it short, imperative, and representative of the actual change.
- The squash commit body must include a blank line after the subject, then the `COMMIT_MESSAGE_SECTION` heading, then the concise bullet list for `SOURCE_COMMIT_RANGE` in chronological order.

### Squash merge semantics

- Perform the content merge from the current branch with `git merge --squash --no-commit <source-branch>`.
- If the squash succeeds and stages changes, create a normal commit using the inferred semantic subject and preserved source-commit body.
- If the squash succeeds but stages nothing, treat it as a no-op merge and continue to cleanup.
- A squash merge does not preserve branch ancestry, so cleanup must delete the source branch with `git branch -D <source-branch>` after successful merge/no-op handling and after removing any linked worktree.

### Cleanup ordering

- Never remove the current worktree.
- If the source branch is attached to a linked worktree, remove that worktree before deleting the branch.
- Cleanup is local-only: do not delete remote branches or push anything unless the user explicitly asks.

## Decisions

Entry state: RESOLVE_SOURCE

### RESOLVE_SOURCE

- guard: `SOURCE_INPUT` exactly matches a linked worktree path after normalisation
  → VERIFY_CURRENT_WORKTREE
- guard: `SOURCE_INPUT` resolves to an existing local branch
  → VERIFY_CURRENT_WORKTREE
- otherwise
  → STOP with error: `SOURCE_INPUT` must be an existing local branch or linked worktree path

### VERIFY_CURRENT_WORKTREE

- guard: current worktree is clean and no git operation is in progress
  → VERIFY_SOURCE
- otherwise
  → STOP with error: current worktree must be clean before merging

### VERIFY_SOURCE

- guard: source branch equals `CURRENT_BRANCH`
  → STOP with error: source and target branch must differ
- guard: source branch has an associated linked worktree and that worktree is dirty or mid-operation
  → STOP with error: source worktree must be clean before merging
- guard: source branch has no linked worktree, or its linked worktree is clean
  → PREPARE_COMMIT_MESSAGE

### PREPARE_COMMIT_MESSAGE

- action: compute `MERGE_BASE`, capture `SOURCE_COMMIT_RANGE`, and draft the semantic squash commit message
- guard: commit range log captured successfully
  → SQUASH_MERGE
- guard: commit range cannot be derived
  → STOP with error

### SQUASH_MERGE

- action: run the squash merge from `CURRENT_BRANCH` using the resolved source branch
- guard: merge exits zero and stages changes
  → COMMIT_SQUASH
- guard: merge exits zero and stages no changes
  → REMOVE_SOURCE_WORKTREE
- guard: merge exits non-zero, including conflicts
  → ROLLBACK_TARGET

### COMMIT_SQUASH

- action: create the squash commit with the prepared subject and preserved source history body
- guard: commit succeeds
  → REMOVE_SOURCE_WORKTREE
- guard: commit fails
  → ROLLBACK_TARGET

### REMOVE_SOURCE_WORKTREE

- guard: no linked source worktree exists
  → DELETE_SOURCE_BRANCH
- guard: linked source worktree exists and is not the current worktree
  → remove it, then DELETE_SOURCE_BRANCH
- guard: linked source worktree is the current worktree
  → STOP with error: never delete the current worktree

### DELETE_SOURCE_BRANCH

- action: delete the merged source branch locally
- guard: deletion succeeds
  → DONE
- guard: deletion fails
  → STOP with error

### ROLLBACK_TARGET

- action: restore the target worktree to `HEAD` with `git reset --hard HEAD`
- always
  → STOP with error: squash merge failed; target worktree restored

### DONE

- terminal state

## Procedures

### RESOLVE_SOURCE

1. Record `CURRENT_BRANCH` with `git symbolic-ref --quiet --short HEAD`. Fail if `HEAD` is detached.
2. Record the current worktree root with `git rev-parse --show-toplevel`.
3. Capture `WORKTREE_LIST_CMD` output once and reuse it throughout the run.
4. Resolve `SOURCE_INPUT` in this order:
   a. Normalise it with `realpath`.
   b. If the normalised path exactly matches a `worktree` entry from the porcelain output, record that as the source worktree path and extract its `refs/heads/<name>` branch.
   c. Otherwise verify `refs/heads/<SOURCE_INPUT>` exists locally and record `<SOURCE_INPUT>` as the source branch.
5. If the resolved source branch appears in the porcelain worktree list, record that linked worktree path for later validation and cleanup.
6. Fail if no source branch can be derived.

### CHECK_WORKTREE_CLEAN

1. In the target worktree context, run `git status --porcelain`; it must return nothing.
2. For each file in `GIT_OPERATION_FILES`:
   a. Resolve its path with `git rev-parse --git-path <name>`.
   b. Fail if that path exists.

### VERIFY_CURRENT_WORKTREE

1. Apply `CHECK_WORKTREE_CLEAN` in the current worktree.
2. Do not stash, auto-commit, or clean files automatically.

### VERIFY_SOURCE

1. Fail if the source branch equals `CURRENT_BRANCH`.
2. If a linked source worktree was recorded:
   a. Fail if it is the same path as the current worktree.
   b. Apply `CHECK_WORKTREE_CLEAN` in the source worktree context by prefixing commands with `git -C <source-worktree>`.
3. If no linked source worktree exists, continue without creating one.

### PREPARE_COMMIT_MESSAGE

1. Compute `MERGE_BASE` with `git merge-base <CURRENT_BRANCH> <source-branch>`.
2. Capture the source-only history with `git log --reverse --format='- [%h] %s' <MERGE_BASE>..<source-branch>`.
3. Review the commit subjects and bodies in that range and infer the best semantic subject line for the squash commit:
   a. Prefer the highest-signal change type represented by the branch, such as `feat`, `fix`, `perf`, or another repo-appropriate semantic type like `task` when that is the dominant convention.
   b. If the branch contains mixed commits, summarise the overall user-facing outcome rather than echoing an implementation detail.
   c. Keep the subject short, imperative, and specific.
4. Build the final commit message in this shape:

   ```text
   <semantic-subject>

   Squashed commits:
   - [short-sha] commit subject
   - [short-sha] commit subject
   ```

5. Preserve every commit from the source-only range in the body as a concise `- [short-sha] subject` list.
6. If the source-only range is empty, still continue; the merge may become a verified no-op and skip commit creation.

### RESET_TARGET

1. Restore the target worktree to `HEAD` with `git reset --hard HEAD`.

### SQUASH_MERGE

1. Run `git merge --squash --no-commit <source-branch>` from the current worktree.
2. If the command exits non-zero, apply `RESET_TARGET` and stop with the merge error.
3. Inspect the index with `git diff --cached --quiet`:
   a. If it exits non-zero, staged changes exist; continue to `COMMIT_SQUASH`.
   b. If it exits zero, no staged changes exist; treat the merge as a no-op and continue to cleanup.

### COMMIT_SQUASH

1. Write the prepared multi-line commit message to a temporary file so the subject and full preserved body are committed exactly as prepared.
2. Create the commit with `git commit -F <message-file>`.
3. If commit creation fails, apply `RESET_TARGET` and stop.

### REMOVE_SOURCE_WORKTREE

1. If no linked source worktree was recorded, skip this procedure.
2. Re-check that the linked source worktree path is not the current worktree path.
3. Remove it with `git worktree remove <source-worktree>`.
4. Do not use `--force`; a dirty worktree should have failed earlier.

### DELETE_SOURCE_BRANCH

1. Delete the source branch with `git branch -D <source-branch>`.
2. Do not touch remote refs.

## Constraints

- Never merge from or into a dirty worktree
- Never stash, auto-commit, or auto-clean either worktree to make the merge proceed
- Never use a generic squash subject when the source history provides enough signal to infer a semantic subject
- Always preserve the source-only commit list in the squash commit body when a squash commit is created, using the concise `- [short-sha] subject` format
- Never switch away from `CURRENT_BRANCH` to perform the merge
- Never delete the current worktree
- Never use `git worktree remove --force`
- Only use `git branch -D` after a successful squash merge or verified no-op merge path
- Never delete remote branches unless the user explicitly asks
- If any validation fails, stop immediately instead of improvising around it

## Validation

Verify all of the following before reporting success:

- [ ] `git symbolic-ref --quiet --short HEAD` still equals `CURRENT_BRANCH`
- [ ] `git status --porcelain` in the current worktree is empty
- [ ] The source branch no longer exists at `refs/heads/<source-branch>`
- [ ] If a source worktree existed, its path no longer appears in `git worktree list --porcelain`
- [ ] If the squash staged changes, `git log -1 --format=%s` is a semantic/conventional-style subject inferred from the source history rather than a generic squash message
- [ ] If the squash staged changes, `git log -1 --format=%B` contains the `Squashed commits:` section followed by the preserved chronological `- [short-sha] subject` list from `MERGE_BASE..source-branch`

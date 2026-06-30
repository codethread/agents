---
description: Finalise AFK loop worktree after flow-build refine/smoke
disable-model-invocation: true
---

# AFK finalise

Uncommitted work remains after `/flow-build--smoke` / `/flow-build--refine`.

Your job: finalise the current slice without starting new work.

## Workflow

1. Inspect the current worktree and recent commit history.
2. Include all intended worktree changes in git.
3. Prefer amending the slice commit when there is an obvious previous slice commit to amend.
4. Otherwise create one conventional commit that captures all current work.
5. Keep the active feature folder's task index/status and feature plan Developer Notes consistent with the actual state.
6. Ensure `git status --porcelain` is empty before you finish.

## Failure handling

Reply `BLOCKED` if you cannot honestly finalise and clear the worktree.

Reply `NO_TASKS_REMAIN` only if the queue is already exhausted and `git status --porcelain` is empty.

## Output contract

Reply with exactly one of:

- `BLOCKED`
- `NO_TASKS_REMAIN`
- A terse one-line summary of what you committed/amended; do not include the literal tokens `BLOCKED` or `NO_TASKS_REMAIN` in a success summary

$ARGUMENTS

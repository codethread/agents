---
name: git-worktree-cleanup
description: Audit and remove merged or superseded Git worktrees.
---

# Worktree cleanup

Clean up by current delivery intent, not Git ancestry alone.

## 1. Inventory

- Fetch remote refs; list worktrees, branches and their ancestry.
- Check tracked changes, untracked files and meaningful ignored files.
- Identify the canonical checkout and active feature stacks.

## 2. Establish current intent

- Read relevant tasks, outcomes and handovers, including closed work.
- Check coordinating lakes and consumer repositories, not just this repo.
- Locate replacement implementations and current delivery instructions.
- Distinguish implemented, approved, merged and deployed.

## 3. Classify every worktree

- **Active:** current delivery or consumers still depend on it.
- **Merged:** exact ancestry, patch equivalence or verified squash merge.
- **Superseded:** newer commissioned work replaces its purpose.
- **Unclear:** a specific dependency or ownership question remains.

Replacement work plus consumers pointing at it is strong supersession evidence.
An open PR, unique commits or missing formal retirement does not by itself justify retaining an obsolete checkout.

## 4. Remove safely

- Preserve active source paths, pinned definitions and runtime dependencies.
- Resolve local changes before deletion; avoid blind forced removal.
- Remove obsolete checkouts with `git worktree remove PATH`.
- Preserve branch history unless branch deletion is requested.
- Treat remote branch deletion and PR closure as separate actions.

## 5. Verify and report

- List remaining worktrees and confirm active work is untouched; report removals, retained work and concrete unresolved questions.
- Rebase only active branches whose intended base has changed; remove obsolete worktrees rather than maintaining them through rebasing.

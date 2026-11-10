---
name: declutter
description: Use when work is complete and you are about to completely stop
---

# Declutter pass

If you made changes, commit them (unless there is strong precedent not to)

Do a cleanup-only pass over this session's work.

Remove cruft that was introduced or made obvious during the session:

- temporary/debug files, scratch scripts, generated leftovers, and unused artifacts
- stale comments, migration notes, TODOs, or explanations of how the code used to work
- compatibility shims, fallback paths, guards, or branches added only while iterating
- unused imports, dead code, abandoned helper functions, and obsolete tests/fixtures
- hanging shells or background processes you started

Keep the code focused on what it does now. Git history preserves what changed; comments should not narrate previous implementations.

Do not use this pass to start new feature work, refactor unrelated code, or broaden scope. If something is uncertain, leave it and mention it briefly instead of guessing.

Ensure your branch(s) and worktrees are clear and well named, in alignment with repo guidance or others. If you superceded old work, you can likely delete those branches and worktree, or report the likely need to clear them back to the user

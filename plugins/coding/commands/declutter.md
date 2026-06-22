---
description: Cleanup pass for session cruft
disable-model-invocation: true
---

# Declutter pass

Do a cleanup-only pass over this session's work.

Remove cruft that was introduced or made obvious during the session:

- temporary/debug files, scratch scripts, generated leftovers, and unused artifacts
- stale comments, migration notes, TODOs, or explanations of how the code used to work
- compatibility shims, fallback paths, guards, or branches added only while iterating
- unused imports, dead code, abandoned helper functions, and obsolete tests/fixtures
- hanging shells or background processes you started

Keep the code focused on what it does now. Git history preserves what changed; comments should not narrate previous implementations.

Do not use this pass to start new feature work, refactor unrelated code, or broaden scope. If something is uncertain, leave it and mention it briefly instead of guessing.

If this session, or recent sessions used `plans/`, `tasks/`, or `tasks/index.yml` and **all** work is now complete with no outstanding comments that need picking up, harvest durable outcomes into the relevant spec, then delete the completed plan/task artifacts. Git history preserves the execution trail.

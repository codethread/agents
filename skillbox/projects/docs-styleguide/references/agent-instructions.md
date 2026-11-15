# Agent instructions

## Place instructions by responsibility

- **AGENTS.md answers “How do I contribute to this project?”** Put durable repository rules and contribution guidance here; use the same responsibility test for CLAUDE.md.
- **Nested AGENTS.md files hold nested guidance.** Put package-specific instructions in that package's file rather than making every task carry them.
- **Skills hold task-specific procedures.** Keep reusable workflows in the relevant skill rather than expanding durable repository rules into a task manual.

Load `writing-for-agents` for information hierarchy, context pointers and pruning rather than inventing a parallel instruction template. When the edit depends on what a harness actually injects or advertises, load `agent-docs-hotpath` and trace the affected loading path; a file's existence alone does not prove the agent sees it.

## Adapt to the known environment

When adapting an existing instruction set, remove inherited procedures that no longer apply and review linked references for the same obsolete assumptions. The result should be a cohesive procedure for the target environment, not a shortened version of every upstream section.

Include the role-specific sequence, constraints and completion criteria needed to act correctly. A role that must operate without further retrieval may need self-contained instructions: a chain of pointers is not a substitute for accessible guidance.

## Concrete behavior beats a slogan

Illustrative example: a query command fetches a fresh page on each invocation and does not retain a snapshot.

**Before:**

> Pages are not snapshots.

**After:**

> Each page request reads the current data. If records change between requests, later pages may omit or repeat records; do not treat the combined pages as a point-in-time export.

Use that replacement only when those semantics are verified. If the command instead pins a snapshot, document that contract. Clearer prose must not invent behavior or add retries, fallbacks or workflow prerequisites that the system does not require.

## Acceptance checks

- Is each instruction owned by the repository, package or task that needs it?
- Can the intended agent follow the supported path without choosing among unavailable tools or reconstructing an old migration?
- Are authoritative help and references accessible, with the role's necessary decisions and completion criteria available at the point of action?
- Does the wording describe verified behavior, including manual next steps, without implying automatic guarantees?

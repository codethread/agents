# AFK Loop Single-Worktree Automation

**Status:** Implemented  
**Last Updated:** 2026-05-10

## 1. Overview

### Purpose

The AFK loop is a synchronous, single-worktree automation system for repeatedly selecting one task slice, asking Pi to complete it, refining it, smoke-checking it, and finalising any leftover work before starting the next slice.

The system is intentionally split across a shell loop, deterministic task files, and prompt templates. The script owns task selection, orchestration, retry limits, and worktree checks; the prompts own task-plan creation, agent behavior, continuation semantics, and final commit expectations.

### Goals

- Consume a deterministic `tasks/index.yml` format created using `skills/afk-create-tasks/SKILL.md`.
- Distinguish unattended AFK slices from human-in-the-loop (HITL) slices without expanding the machine-readable YAML schema.
- Select one runnable `pending` or `in_progress` task slice per Pi session, then loop until blocked or exhausted.
- Treat `BLOCKED` and `NO_TASKS_REMAIN` as stop tokens even if the model includes surrounding text; any other successful `/afk` output is treated as a success summary.
- Allow a later Pi session to continue an existing `in_progress` slice after a failed/timed-out run.
- Recover from transient main Pi invocation failures by retrying the loop.
- Ensure smoke/refine edits are committed or amended before the next slice begins.

### Non-Goals

- No concurrent execution in one worktree.
- No clever Pi session resume requirement; a fresh Pi session may continue from the worktree and task index.
- No distributed locking. Parallelism should use separate git worktrees.
- No attempt to classify every Pi failure cause; repeated failure threshold is the safety stop.

## 2. Design Decisions

- **Decision:** The task queue has one deterministic YAML shape: top-level `tasks`.
  - **Rationale:** The loop owns task consumption and should fail loudly when the task plan is malformed instead of guessing alternate schemas.

- **Decision:** Task creation uses tracer-bullet vertical slices.
  - **Rationale:** Each slice should be independently verifiable and cut through the relevant integration path, which makes AFK execution safer than broad layer-by-layer tasks.

- **Decision:** Task YAML stays machine-readable and minimal; agent notes go in the task plan README beside the YAML.
  - **Rationale:** Keeping notes append-only in markdown reduces YAML churn and scope creep while preserving discoveries for later refinement passes.

- **Decision:** Dependencies live only in `tasks/index.yml`, not task markdown prose.
  - **Rationale:** The loop needs one deterministic dependency source, while task markdown remains focused on implementation scope and acceptance criteria.

- **Decision:** AFK/HITL classification is encoded in human-facing task content, not an extra YAML field.
  - **Rationale:** The loop only needs statuses and blockers. HITL work is represented as `blocked` plus a `[HITL]` description prefix and `Type: HITL` in the task file, keeping the queue schema stable while making human intervention visible.

- **Decision:** HITL decisions should unlock separate AFK implementation slices.
  - **Rationale:** Human uncertainty should not leak into unattended tasks. Capturing a decision, access grant, design review, or manual QA verdict as its own blocked slice lets later AFK tasks run from a clear contract.

- **Decision:** The script retries failed main `/afk` Pi invocations, while the prompt allows `in_progress` continuation.
  - **Rationale:** Network/API/time-out failures can leave useful work in the worktree. Because the loop is synchronous in a single worktree, the safest recovery is to run a new Pi session that sees the existing `in_progress` task and continues it.

- **Decision:** Only unhappy-path tokens are machine-parsed; other successful `/afk` output is treated as a terse success summary.
  - **Rationale:** Requiring exact `COMPLETE` output proved brittle. Detecting `BLOCKED` and `NO_TASKS_REMAIN` anywhere in output makes the loop tolerant of small formatting drift while still recognizing unhappy paths. Success summaries must not include those reserved tokens.

- **Decision:** `/afk-finalise` is a separate prompt instead of embedding commit instructions only in the script.
  - **Rationale:** Finalisation requires judgment about whether to amend the slice commit or create a new commit. Keeping this as a prompt makes the agent responsible for git intent while the script only verifies that the worktree is clean afterward.

- **Decision:** New Pi sessions are named from the loop count plus selected task id and description.
  - **Rationale:** Friendly names make later session picking/resume easier, while the loop count avoids clashes when repeated fresh sessions continue the same task without resuming history.

- **Decision:** Three consecutive main Pi failures stop the loop.
  - **Rationale:** A small retry budget handles transient failures without hiding persistent problems that need user inspection.

## 3. System Boundary

The AFK loop system consists of:

- `scripts/afk-loop.nu` — task selection, orchestration loop, Pi process handling, retry counter, stop-token detection, smoke/refine/finalise sequencing, and git cleanliness verification.
- `skills/afk-create-tasks/SKILL.md` — creates `tasks/index.yml`, `tasks/README.md`, and per-task markdown files in the deterministic queue format.
- `prompts/afk.md` — scripted single-slice implementation contract for a task preselected by the loop.
- `prompts/hitl.md` — human-in-the-loop single-tick prompt with task selection and normal conversational reporting.
- `prompts/afk-finalise.md` — final worktree cleanup contract after smoke/refine leave uncommitted changes.

Code is the source of truth for command sequencing and exact retry behavior; prompts are the source of truth for agent obligations inside each Pi session.

## 4. Task Queue Contract

`tasks/index.yml` must use this top-level shape:

```yaml
tasks:
  - id: 1
    description: Terse task title
    task_file: tasks/001-terse-task-title.md
    status: pending
    blocked_by: []
```

The loop consumes only `tasks`. It does not support alternate top-level names or schemas.

Allowed statuses:

- `pending` — not started.
- `in_progress` — selected or resumed by the loop/HITL prompt.
- `blocked` — requires human adjudication; skipped by the AFK loop.
- `complete` — finished and committed.

AFK/HITL classification rules:

- AFK tasks are unattended implementation slices and normally start as `pending`.
- HITL tasks require human input before unattended execution is safe. They use a `[HITL]` description prefix, start as `blocked` unless the human input is already available, and include `Type: HITL` as the first line under `## Scope` in the task file.
- Task files include `Type: AFK` or `Type: HITL` under `## Scope`; this is for humans and agents, not for the loop parser.
- The YAML schema does not include a `type` field.
- AFK tasks unlocked by HITL decisions use `blocked_by` to depend on the HITL task.

Agents should only change task YAML status fields during execution. Notes, deferred edge cases, blocker context, and follow-up scope belong in the append-only `Developer Notes` section of the task plan README beside `index.yml`.

## 5. Prompt Sync Contract

`prompts/afk.md` and `prompts/hitl.md` intentionally duplicate the core single-slice work contract. Keep these sections semantically in sync whenever either prompt changes:

- Workflow expectations: robustness skill loading, status transition, implementation scope, validation, commit, review, amend, and stop-after-one-slice behavior.
- Boundaries: stay within the slice, no future work, no weakened tests/contracts, fail loudly.
- Failure/blocker rules: when a slice cannot honestly be completed, how task status and `tasks/README.md` Developer Notes are handled, and when review feedback is out of scope.

Intentional differences:

- `afk.md` receives a selected task and must not perform task selection.
- `afk.md` has a loop-oriented output contract: `BLOCKED` and `NO_TASKS_REMAIN` are machine-parsed stop tokens; other output is treated as success summary.
- `hitl.md` performs task selection for a human-led session, may discuss blocked tasks with the user, and reports conversationally rather than using the strict loop output contract.

## 6. Code Locations

- `scripts/afk-loop.nu`
- `skills/afk-create-tasks/SKILL.md`
- `prompts/afk.md`
- `prompts/hitl.md`
- `prompts/afk-finalise.md`

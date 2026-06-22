---
name: devflow
description: >
  Entry point for the devflow workspace lifecycle. Load this first when the user asks to run a devflow phase,
  create or inspect devflow artifacts, decide what phase comes next, generate RFC/spec/plan/tasks, run a feature
  through AFK work, or finish/archive a feature.
metadata:
  intent: >-
    provide the cheap workflow state machine and delegate phase details to the focused reference skills
---

# Devflow lifecycle

Devflow turns an idea into a feature-local workspace, optional decision/spec artifacts, AFK task slices, and a finished archive.

This is the entry skill. Use it to identify the current phase, satisfy prerequisites, and then load the phase-specific reference skill only when you need details.

## Workspace shape

```text
devflow/
|-- README.md
|-- rfcs/
|-- specs/
|-- <feat-name>/
|   |-- proposal.md
|   |-- specs/
|   |   |-- <existing-spec>.delta.md
|   |   `-- <new-spec>.md
|   |-- <feat-name>.plan.md
|   `-- tasks/
|       |-- index.yml
|       `-- <zero-padded-id>-<slug>.md
`-- archive/
    `-- yy-mm-dd__<feat-name>/
```

Root specs in `devflow/specs/` are canonical. Feature-local specs/deltas are pending work. Archived feature folders are historical context only.

## Reference table

| Phase            | Artifact(s)                                                                  | Detail skill / file                                           | Required?                                |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| Orient           | existing `devflow/` state, relevant code                                     | this skill                                                    | Always                                   |
| RFC              | `devflow/rfcs/YYYY-MM-DD-<slug>.md`                                          | `plugins/devflow/skills/rfc-authoring/SKILL.md`               | Optional; use for meaningful uncertainty |
| Proposal         | `devflow/<feat-name>/proposal.md`                                            | this skill                                                    | Required for feature folders             |
| Spec work        | `devflow/specs/*.md`, `devflow/<feat-name>/specs/*.md`, `*.delta.md`         | `plugins/devflow/skills/spec-authoring/SKILL.md`              | Optional unless durable contracts change |
| Plan             | `devflow/<feat-name>/<feat-name>.plan.md`                                    | `plugins/devflow/skills/plan-authoring/SKILL.md`              | Required for queued/AFK work             |
| Tasks            | `devflow/<feat-name>/tasks/index.yml`, `tasks/*.md`                          | `plugins/devflow/skills/task-authoring/SKILL.md`              | Required for AFK loop                    |
| AFK execution    | task status changes, code commits, plan Developer Notes                      | `plugins/devflow/scripts/afk-loop.nu`, `commands/flow-init-*` | Optional execution mode                  |
| Finish / archive | promoted root specs, updated index, shipped/abandoned plan, archived feature | this skill + spec/plan skills for detailed edits              | Required when feature work ends          |
| Migration        | moved planning files into `devflow/`                                         | `plugins/devflow/commands/migrate.md`                         | One-time user command only               |

## Lifecycle flow

```dot
digraph devflow {
  rankdir = LR;

  idea [label = "Idea / request"];
  orient [label = "Orient\nread devflow + code"];
  rfc [label = "Optional RFC\ndevflow/rfcs/*"];
  proposal [label = "Proposal\ndevflow/<feat>/proposal.md"];
  specs [label = "Optional spec work\nroot specs + feature deltas"];
  plan [label = "Plan\ndevflow/<feat>/<feat>.plan.md"];
  tasks [label = "Tasks\ndevflow/<feat>/tasks/index.yml"];
  afk [label = "AFK loop / HITL\nexecute slices"];
  finish [label = "Finish\npromote specs + mark state"];
  archive [label = "Archive\ndevflow/archive/yy-mm-dd__<feat>/"];

  idea -> orient -> rfc [label = "uncertainty", style = dashed];
  orient -> proposal [label = "direction clear"];
  rfc -> proposal [label = "accepted direction"];
  proposal -> specs [label = "contract changes", style = dashed];
  proposal -> plan;
  specs -> plan;
  plan -> tasks -> afk -> finish -> archive;
  plan -> finish [label = "abandon", style = dashed];
}
```

## Phase selection

When the user invokes a devflow phase command, jump to that phase but satisfy prerequisites first.

| User intent / command  | Start state                                        | Required prerequisite behavior                                                                        |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `devflow ...`          | unknown                                            | Orient, infer current phase, then continue or ask one clarifying question                             |
| `devflow-rfc ...`      | idea has uncertainty                               | Read relevant specs/code, then load RFC_SKILL                                                         |
| `devflow-proposal ...` | feature folder framing requested                   | Create/choose feature folder; link relevant RFC/specs; write `proposal.md`                            |
| `devflow-spec ...`     | durable contract or feature delta requested        | Ensure root vs feature-local target is clear; load SPEC_SKILL                                         |
| `devflow-plan ...`     | implementation strategy requested                  | Ensure `proposal.md` exists; create minimal proposal if user supplied enough context; load PLAN_SKILL |
| `devflow-tasks ...`    | task queue requested                               | Ensure `proposal.md` and a reviewed plan, or minimal plan marked Reviewed, exists; load TASKS_SKILL   |
| `devflow-afk ...`      | user wants to run or prepare the AFK loop          | Verify proposal, plan, task index, runnable queue, and provide the exact loop command                 |
| `devflow-finish ...`   | feature is shipped, abandoned, or ready to archive | Run Finish / archive procedure below                                                                  |

Small obvious changes may skip RFCs and spec deltas. They may not skip `proposal.md` or the plan if they will use `tasks/` or `afk-loop`; create minimal versions instead.

## Procedures

### ORIENT

1. Inspect `devflow/README.md` if it exists.
2. Inspect relevant active feature folder(s) under `devflow/<feat-name>/` when named or obvious.
3. Inspect root specs in `devflow/specs/` and RFCs in `devflow/rfcs/` only as needed.
4. Read affected code before writing specs, plans, or tasks that depend on implementation reality.
5. Determine the phase and continue; ask only if the feature name, artifact target, or ownership is ambiguous.

### WRITE_PROPOSAL

Use this when a feature folder needs `proposal.md` and no deeper skill is necessary.

1. Choose a kebab-case `<feat-name>` from the user's request; ask if ambiguous.
2. Create `devflow/<feat-name>/` and `devflow/<feat-name>/specs/` if needed.
3. Write `devflow/<feat-name>/proposal.md`:

```markdown
# <Feature name> Proposal

**Last Updated:** <YYYY-MM-DD>
**Related RFCs:** <links or "None">
**Related root specs:** <links or "None">

## Problem

What problem this feature/change solves.

## Goals

- Desired outcomes.

## Non-goals

- Boundaries intentionally out of scope.

## Proposed scope

What should change at product/domain level. Keep implementation strategy out of this section.

## Open questions

- Questions that must be resolved before planning or tasking.
```

4. If the proposal exposes unresolved alternatives, use RFC_SKILL before planning.
5. If the proposal changes durable contracts, use SPEC_SKILL for feature-local spec deltas.

### JUMP_TO_TASKS

1. Ensure a feature folder exists.
2. Ensure `proposal.md` exists. If the user provided enough context, create a minimal proposal; otherwise ask for the feature name/scope.
3. Ensure `<feat-name>.plan.md` exists and is Reviewed. For small obvious work, create a minimal plan and mark it Reviewed after a lightweight sanity check; for non-trivial work, load PLAN_SKILL and produce/review the plan.
4. Load TASKS_SKILL and create/update `tasks/index.yml` plus task files.
5. Keep task context and Developer Notes in the plan.

### PREPARE_AFK

Run this when the user asks to run or prepare the AFK loop.

1. Identify `devflow/<feat-name>/`; ask if ambiguous.
2. Verify required files exist:
   - `proposal.md`
   - `<feat-name>.plan.md`
   - `tasks/index.yml`
3. Verify the plan status is Reviewed or Active. If the plan is Draft, route the user back to `devflow-plan` before emitting a loop command.
4. Inspect `tasks/index.yml` for exactly one or zero `in_progress` tasks, valid `blocked_by` ids, and at least one runnable `pending` task or one existing `in_progress` task.
5. If all tasks are `complete`, report that the queue is exhausted and route the user to `devflow-finish` / FINISH_ARCHIVE instead of giving a loop command.
6. If no runnable task exists because work is blocked, report the blocked/HITL state instead of giving a loop command.
7. If the worktree is dirty and there is no `in_progress` task, tell the user to commit/stash/clean before running the loop.
8. Give the user a Nushell command using a repo-relative path:

```nu
use plugins/devflow/scripts/afk-loop.nu *
afk-loop <feat-name> "<additional context>"
```

Use `afk-loop devflow/<feat-name> "<additional context>"` when the user supplied a folder path instead of a feature name.

### FINISH_ARCHIVE

Run this when feature work is shipped, intentionally abandoned, or the user asks to finish/archive a feature.

1. Identify `devflow/<feat-name>/`; ask if ambiguous.
2. Read:
   - `proposal.md`
   - `<feat-name>.plan.md`
   - `tasks/index.yml` and task files if present
   - `specs/*` feature-local specs/deltas
   - affected root specs in `devflow/specs/`
3. Reconcile task state and implementation reality:
   - For shipped work, confirm tasks intended for the shipped scope are complete and code/tests cover that scope.
   - If tasks remain incomplete, classify them as cut scope before archiving.
   - Record cut, deferred, or abandoned scope in the plan's final Developer Notes; do not promote unshipped behavior into root specs unless the user explicitly asks.
4. Decide outcome:
   - **Shipped:** implementation is complete enough that durable outcomes should become canonical.
   - **Abandoned:** work stops intentionally; do not promote unshipped contract changes unless the user explicitly asks.
5. For shipped work:
   - load SPEC_SKILL for detailed merge rules
   - merge each `devflow/<feat-name>/specs/*.delta.md` into its matching root spec
   - promote each new feature spec that should become canonical into `devflow/specs/`
   - update `devflow/README.md` spec index
   - mark feature-local deltas `Merged`
6. Update `<feat-name>.plan.md`:
   - set `Status: Shipped` or `Status: Abandoned`
   - update `Last Updated`
   - add a final Developer Notes entry summarizing shipped scope, cut scope, or abandonment reason
7. Move the whole folder to `devflow/archive/yy-mm-dd__<feat-name>/`.
8. Report the root specs updated, folder archived, and any cut or unpromoted scope.

## Delegation rules

- Load RFC_SKILL for RFC file structure, status handling, and alternatives/tradeoff writing.
- Load SPEC_SKILL for root spec writing, feature-local deltas, and promotion details.
- Load PLAN_SKILL for non-trivial implementation strategy, plan review, and plan updates.
- Load TASKS_SKILL for deterministic AFK task queues.
- Use this skill itself for phase selection, proposal creation, and finish/archive orchestration.

## Invariants

- `devflow/specs/` is canonical for current contracts.
- `devflow/<feat-name>/specs/` is staging for active feature changes.
- `devflow/archive/*` is historical context, not current truth.
- Any feature using `tasks/` must have `proposal.md` and `<feat-name>.plan.md`.
- Do not create task-note README files; Developer Notes live in the feature plan.
- Do not copy RFC alternatives into specs, plans, or tasks; link to the RFC.

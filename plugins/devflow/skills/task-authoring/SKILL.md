---
name: task-authoring
description: >
  Create deterministic AFK task queues inside devflow feature folders. Use when the user asks to create
  or amend a task queue, break a reviewed feature plan into tasks, generate tasks/index.yml, or convert
  a small feature/problem/spec/RFC into unattended implementation slices.
---

# Task Authoring Guide

Use this skill to create or update a deterministic, feature-local AFK task queue that can be consumed by the AFK loop. Tasks are the execution layer: they may be more specific than the feature plan, but they should reference the proposal/spec/RFC/plan instead of duplicating rationale.

Task queues live under `devflow/<feat-name>/tasks/`. Task context and append-only developer notes live in `devflow/<feat-name>/<feat-name>.plan.md`; do not create a task README.

## Process

### 1. Gather context

Work from the current conversation and the user's request. If references are provided, read them fully before drafting tasks.

A task queue always requires `devflow/<feat-name>/proposal.md` and a Reviewed `devflow/<feat-name>/<feat-name>.plan.md`. For non-trivial work, prefer a reviewed feature plan as the source of sequencing. If the request jumps from a broad proposal/spec/RFC directly to tasks and the implementation approach is not yet reviewable, use `plan-authoring` first. For small, obvious changes, create a minimal plan and mark it Reviewed after a lightweight sanity check before writing tasks.

Read, as relevant:

- `devflow/<feat-name>/proposal.md`
- `devflow/<feat-name>/<feat-name>.plan.md`
- `devflow/<feat-name>/specs/*`
- `devflow/specs/*`
- `devflow/rfcs/*`
- affected code and tests

If an accepted RFC is referenced, treat it as decision history: preserve the chosen direction without copying its alternatives into task files.

### 2. Confirm feature folder

Tasks must belong to exactly one active feature folder. If the feature name is not provided and cannot be inferred from the plan/proposal path, ask for it before writing files.

Expected output paths:

- `devflow/<feat-name>/tasks/index.yml`
- `devflow/<feat-name>/tasks/<zero-padded-id>-<slug>.md`
- developer notes in `devflow/<feat-name>/<feat-name>.plan.md`

### 3. Explore the codebase when needed

If the implementation area is unclear, inspect the codebase before writing tasks. Use project domain vocabulary and respect existing RFCs, specs, plans, READMEs, tests, and architecture.

### 4. Draft vertical slices

Break the work into **tracer-bullet vertical slices**. Each task should deliver a narrow but complete path through the relevant integration layers, not a horizontal layer-only change.

Slice rules:

- Each completed task is independently verifiable.
- Prefer many thin slices over a few broad slices.
- Prefer AFK-ready tasks where possible.
- Mark dependencies in YAML `blocked_by`, not in task markdown prose.
- Put human/architectural uncertainty into the feature plan's Task context or Developer Notes, not hidden in task scope.

### 5. Add execution-level specificity

Task files are allowed to be more specific than the plan:

- Name exact files, functions, commands, fixtures, and assertions when they are needed for unattended execution.
- Keep rationale short and link to the RFC/spec/proposal/plan for the why and high-level how.
- Do not copy the plan's phase prose into every task; translate it into narrow implementation contracts.
- Avoid broad file inventories. Include only references the task implementer must inspect or change.

### 6. Classify AFK vs HITL

Classify every slice before writing files:

- **AFK**: safe for an unattended agent loop. The task has a clear contract, enough context, deterministic validation, and can be completed without asking the user for decisions, credentials, design judgment, or external access.
- **HITL**: requires human interaction before unattended work is safe, such as an architectural decision, product/design choice, unclear acceptance criteria, secret/access setup, manual QA, or choosing between meaningful tradeoffs.

Prefer AFK slices where possible. Do not mark a slice HITL just because it is complex; split complex work into smaller AFK slices instead.

Encoding rules:

- Do not add a YAML `type` field. The task index schema is fixed.
- For AFK tasks, use `status: pending`; use `blocked_by` for dependencies instead of setting dependency-blocked AFK work to `blocked`.
- For HITL tasks, prefix the `description` with `[HITL]` and set `status: blocked` unless the required human input has already been provided.
- In each task file, put `Type: AFK` or `Type: HITL` as the first line under `## Scope`.
- If HITL produces a decision that unlocks implementation, make the decision task HITL and create separate AFK implementation task(s) blocked by that HITL task.
- Keep human uncertainty out of AFK task scope.

### 7. Create or update the task queue

Create the files below. Do not ask for approval unless the source context is too ambiguous to produce a safe MVP task queue.

### 8. Request review

Before finalizing a new or substantially changed task queue:

1. Ask a dedicated review agent to inspect the full sequence for ordering issues, dependency deadlocks, and missed prerequisite work.
2. Ask review agents to inspect individual task files for whether each task is standalone and clear without relying on prior conversation context beyond referenced repository documentation.
3. Ask for a holistic review of cohesion between the task queue, referenced RFCs/specs/proposal/plan, and stated MVP goal, calling out any misalignment.

## Output files

Create or update `devflow/<feat-name>/tasks/` containing:

- `tasks/index.yml` — machine-readable task queue in the exact format below, stored at `devflow/<feat-name>/tasks/index.yml`.
- `tasks/<zero-padded-id>-<slug>.md` — one markdown file per task, e.g. `devflow/<feat-name>/tasks/001-terse-task-title.md`.

Put task context, important references, amendment rationale, discoveries, blockers, and follow-up scope in the feature plan under `## 8. Task context` or `## 9. Developer Notes`.

## `tasks/index.yml` format

Use this exact top-level shape. Paths are relative to the feature folder, so task files are written as `tasks/<file>.md`:

```yaml
tasks:
  - id: 1
    description: Terse task title
    task_file: tasks/001-terse-task-title.md
    status: pending
    blocked_by: []
```

Rules:

- `id` is an integer, starting at `1`, increasing by one.
- `description` is short enough to use in a session name.
- `task_file` points to the detailed task markdown file, using a three-digit zero-padded id plus slug (`tasks/001-terse-task-title.md`).
- `status` is one of: `pending`, `in_progress`, `blocked`, `complete`.
- New queues start with AFK tasks as `pending`; HITL tasks may start as `blocked` when human input is required.
- `blocked_by` is a list of task ids that must be `complete` before this task can run.
- Do not add extra fields. Put notes in the feature plan, not the YAML.

## Feature plan notes format

Ensure the feature plan includes these sections:

```markdown
## 8. Task context

Problem statement / MVP goal, important references, and task strategy.

## 9. Developer Notes

Append notes here. Do not rewrite earlier notes.

### Task <id>: <description> — <YYYY-MM-DD>

- Note relevant for later agents or follow-up scope.
```

If the plan uses different numbering, preserve the local numbering but keep `Task context` and `Developer Notes` headings.

## Task file format

Each `tasks/<zero-padded-id>-<slug>.md` should include exactly these headings:

```markdown
# Task <id>: <description>

## Scope

## Must implement exactly

## Done when

## Out of scope

## References
```

Guidance:

- Start `## Scope` with exactly one classification line: `Type: AFK` or `Type: HITL`.
- Describe end-to-end behavior, not a layer-by-layer checklist.
- Include exact files/functions/commands when they make the task safer for unattended execution.
- Reference accepted RFCs, root specs, feature-local specs, the proposal, and the plan when needed; do not duplicate their rationale or alternatives.
- Acceptance criteria belong in `Done when`.
- Dependencies belong only in `tasks/index.yml` `blocked_by`.
- Keep slices small enough for one agent run.
- Prefer a workable MVP over comprehensive scope.
- Put follow-up ideas in the feature plan's Developer Notes rather than expanding the slice.

## Boundaries

- Create or update the task queue only; do not implement the tasks.
- Make dependencies explicit and minimal.
- Do not create speculative future work unless needed to protect the MVP boundary.
- Do not use tasks as durable documentation. Root specs own durable outcomes; feature folders preserve historical execution context after archive.

## Follow-up changes to an existing queue

When updating an existing queue:

- Read `devflow/<feat-name>/tasks/index.yml`, the feature plan, and relevant task files before editing.
- Preserve task ids, file names, and history for existing tasks unless the task has not started and the change is purely clarifying.
- Do not edit completed task files except to fix broken formatting or references that prevent the queue from running.
- Prefer adding new follow-up tasks over rewriting old tasks. Use the next available integer ids; do not use decimal ids.
- If a missed requirement belongs conceptually after task 3, add new tasks with new integer ids and set `blocked_by` to `[3]` or to the specific prerequisite task ids.
- If a pending task is too broad, narrow that task in place only when no agent has started it; move extracted work into new tasks with new integer ids.
- If an in-progress or completed task is too broad, leave its published contract intact and add follow-up tasks for the extracted work.
- Append amendment rationale to the feature plan's Developer Notes. Do not hide important plan changes only in task files.

## Retirement and archive

When all tasks for the feature are complete and the work has shipped, return to `plugins/devflow/skills/devflow/SKILL.md` and run its FINISH_ARCHIVE procedure. That procedure owns spec promotion, plan status, cut-scope notes, and moving the feature folder to `devflow/archive/yy-mm-dd__<feat-name>/`.

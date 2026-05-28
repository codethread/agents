---
name: afk-create-tasks
description: >
  Create deterministic AFK task files from current planning context. Use when the user asks to
  create an AFK task plan, break work into tasks for the AFK loop, generate tasks/index.yml,
  or convert a feature/problem/spec into unattended implementation slices.
---

# Create AFK task plan

$ARGUMENTS

Study the user's request and any referenced context.

Your job: create a deterministic AFK task plan that can be consumed by the AFK loop.

## Process

### 1. Gather context

Work from the current conversation and the user's request. If references are provided, read them fully before drafting tasks.

### 2. Explore the codebase when needed

If the implementation area is unclear, inspect the codebase before writing tasks. Use project domain vocabulary and respect existing specs, READMEs, tests, and architecture.

### 3. Draft vertical slices

Break the work into **tracer-bullet vertical slices**. Each task should deliver a narrow but complete path through the relevant integration layers, not a horizontal layer-only change.

Slice rules:

- Each completed task is independently verifiable.
- Prefer many thin slices over a few broad slices.
- Prefer AFK-ready tasks where possible.
- Mark dependencies in YAML `blocked_by`, not in task markdown prose.
- Put human/architectural uncertainty into `tasks/README.md` context or Developer Notes, not hidden in task scope.

### 4. Classify AFK vs HITL

Classify every slice before writing files:

- **AFK**: safe for an unattended agent loop. The task has a clear contract, enough context, deterministic validation, and can be completed without asking the user for decisions, credentials, design judgment, or external access.
- **HITL**: requires human interaction before unattended work is safe, such as an architectural decision, product/design choice, unclear acceptance criteria, secret/access setup, manual QA, or choosing between meaningful tradeoffs.

Prefer AFK slices where possible. Do not mark a slice HITL just because it is complex; split complex work into smaller AFK slices instead. Use HITL only when the next safe action genuinely needs a person. HITL slices must still have a concrete completion artifact: a captured decision, reviewed design, provisioned access, manual QA verdict, or clarified acceptance criteria.

Encoding rules:

- Do not add a YAML `type` field. The task index schema is fixed.
- For AFK tasks, use `status: pending`; use `blocked_by` for dependencies instead of setting dependency-blocked AFK work to `blocked`.
- For HITL tasks, prefix the `description` with `[HITL]` and set `status: blocked` unless the required human input has already been provided.
- In each task file, put `Type: AFK` or `Type: HITL` as the first line under `## Scope`.
- If HITL produces a decision that unlocks implementation, make the decision task HITL and create separate AFK implementation task(s) blocked by that HITL task.
- Keep human uncertainty out of AFK task scope. If an AFK task would need to ask the user a question, either narrow it until it does not, or introduce a preceding HITL task.

### 5. Create the task plan

Create the files below. Do not ask for approval unless the source context is too ambiguous to produce a safe MVP task plan.

### 6. Request review

Before finalizing the task plan:

1. Ask a dedicated review agent to inspect the full task sequence for ordering issues, dependency deadlocks, and missed prerequisite work.
2. Ask review agents to inspect individual task files for whether each task is standalone and clear without relying on prior conversation context beyond codebase documentation.
3. Ask for a holistic review of cohesion between the task plan, referenced specs, and stated MVP goal, calling out any misalignment.

## Output files

Create a `tasks/` directory containing:

- `tasks/index.yml` — machine-readable task queue in the exact format below.
- `tasks/README.md` — human-readable problem statement, context links, and append-only developer notes.
- `tasks/<id>-<slug>.md` — one markdown file per task.

## `tasks/index.yml` format

Use this exact top-level shape:

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
- `task_file` points to the detailed task markdown file.
- `status` is one of: `pending`, `in_progress`, `blocked`, `complete`.
- New plans start with AFK tasks as `pending`; HITL tasks may start as `blocked` when human input is required.
- `blocked_by` is a list of task ids that must be `complete` before this task can run.
- Do not add extra fields. Put notes in `tasks/README.md`, not the YAML.

## `tasks/README.md` format

Include:

1. Problem statement / MVP goal.
2. Important references: specs, PRDs, docs, source files, or discussion artifacts the task plan depends on.
3. Task strategy: brief explanation of how the slices fit together, including why any HITL slices are required and what AFK work they unlock.
4. Developer Notes: an append-only section for agents working the loop.

Developer Notes format:

```markdown
## Developer Notes

Append notes here. Do not rewrite earlier notes.

### Task <id>: <description> — <YYYY-MM-DD>

- Note relevant for later agents or follow-up scope.
```

## Task file format

Each `tasks/<id>-<slug>.md` should include exactly these headings:

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
- Avoid specific file paths unless they are stable references the implementer must inspect.
- Acceptance criteria belong in `Done when`.
- Dependencies belong only in `tasks/index.yml` `blocked_by`.
- Keep slices small enough for one agent run.
- Prefer a workable MVP over comprehensive scope.
- Put follow-up ideas in `tasks/README.md` Developer Notes rather than expanding the slice.

## Boundaries

- Create the plan only; do not implement the tasks.
- Make dependencies explicit and minimal.
- Do not create speculative future work unless needed to protect the MVP boundary.

## Follow-up changes to an existing plan

The request may be to amend an existing `tasks/` plan instead of creating one from scratch.

When updating an existing plan:

- Read `tasks/index.yml`, `tasks/README.md`, and relevant task files before editing.
- Preserve task ids, file names, and history for existing tasks unless the task has not started and the change is purely clarifying.
- Do not edit completed task files except to fix broken formatting or references that prevent the plan from running.
- Prefer adding new follow-up tasks over rewriting old tasks. Use the next available integer ids; do not use decimal ids like `3.1` because the task index format requires integer ids.
- If a missed requirement belongs conceptually after task 3, add new tasks with new integer ids and set `blocked_by` to `[3]` or to the specific prerequisite task ids.
- If a pending task is too broad, narrow that task in place only when no agent has started it; move extracted work into new tasks with new integer ids.
- If an in-progress or completed task is too broad, leave its published contract intact and add follow-up tasks for the extracted work.
- Append amendment rationale to `tasks/README.md` Developer Notes. Do not hide important plan changes only in task files.

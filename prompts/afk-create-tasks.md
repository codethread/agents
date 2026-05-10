---
description: Create deterministic AFK task files from current planning context
argument-hint: describe the feature/problem, or reference PRDs/specs/discussion notes
---

# Create AFK task plan

Study $ARGUMENTS

Your job: create a deterministic AFK task plan that can be consumed by the AFK loop.

## Process

### 1. Gather context

Work from the current conversation and the arguments above. If references are provided, read them fully before drafting tasks.

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

### 4. Create the task plan

Create the files below. Do not ask for approval unless the source context is too ambiguous to produce a safe MVP task plan.

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
- New plans start with every task as `pending` unless there is a clear reason otherwise.
- `blocked_by` is a list of task ids that must be `complete` before this task can run.
- Do not add extra fields. Put notes in `tasks/README.md`, not the YAML.

## `tasks/README.md` format

Include:

1. Problem statement / MVP goal.
2. Important references: specs, PRDs, docs, source files, or discussion artifacts the task plan depends on.
3. Task strategy: brief explanation of how the slices fit together.
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

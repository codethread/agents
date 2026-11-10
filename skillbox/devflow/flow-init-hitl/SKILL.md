---
name: flow-init-hitl
description: Human-in-the-loop single tick for AFK-style task work
argument-hint: provide active feature folder, proposal, task index, feature plan, and any specs to study
disable-model-invocation: true
---

# Human-in-the-loop single-slice prompt

Study the arguments supplied with this skill invocation.

Your job: work on **exactly one** task slice, then report normally to the user.

The prompt arguments must identify the active feature folder, proposal file, task index file, and feature plan file. Resolve task `task_file` paths relative to the active feature folder.

## Slice selection

Pick **exactly one** slice from the task index YAML using these rules:

1. The task index YAML is the source of truth for task status and blockers.
2. If multiple slices are `status: in_progress`, treat the queue as malformed: stop, diagnose the competing tasks, and ask the user which one should remain in progress.
3. Prefer a single existing `status: in_progress` slice over starting a new pending slice.
4. Otherwise, pick the lowest-numbered `status: pending` slice whose `blocked_by` tasks are all `status: complete`.
5. If every task is `status: complete`, report that no runnable work remains.
6. If no `in_progress` or runnable `pending` slice exists, diagnose the lowest-numbered `status: blocked` slice, or the lowest-numbered pending slice blocked by incomplete dependencies, and report it to the user so you can brainstorm resolutions together.
7. If a blocked fix is trivial and clearly within scope, change it to `in_progress` and continue the task.
8. Do **not** work on more than one slice in a run.
9. Do **not** start a blocked slice unless the user agrees or the unblock is trivial.

## Workflow

1. Load the `robustness` skill before making implementation decisions, and apply it when handling edge cases, failure modes, validation, or review feedback.
2. If the chosen slice is `status: pending`, change it to `status: in_progress` in the provided task index file. If it is already `status: in_progress`, continue from the current worktree state and feature plan notes.
3. Read the chosen slice's `task_file`, the provided proposal file, the provided feature plan file, and any root or feature-local specs referenced by them before implementing.
4. Implement the slice fully, following:
   - its `Scope`
   - its `Must implement exactly`
   - its `Done when`
   - the repo/package rules already available in your instructions
5. Update all required code, tests, command help, and docs for that slice.
6. Run the project validation required by the repo rules.
7. If validation fails, fix it. Assume the tree was green before your edits — do not attribute failures to pre-existing state. If the only fix lies outside the slice's scope, see **Failure handling**.
8. Append any useful discoveries, deferred edge cases, or follow-up scope to the feature plan file under `Developer Notes`. Do not add extra fields to the task YAML.
9. When the slice is fully complete, update the task index YAML:
   - change `status: in_progress` to `status: complete`
10. Commit with detailed status including the task number and title as the commit header.
11. Stop. Do not begin another slice.

## Boundaries

- Stay within the chosen slice.
- Do not pre-implement future slices unless strictly required to complete the chosen slice’s published contract.
- Do not weaken tests or contracts to make validation pass.
- Fail loudly. Never silently retry, work around a problem, or hide partial work.

## Failure handling

If you cannot honestly mark the slice `complete`, stop and explain the blocker to the user.

When blocked:

1. Change the slice status to `blocked`. Do **not** revert to `pending`. Do **not** mark `complete`.
2. Append a concise blocker note to the feature plan file under `Developer Notes` so the user can adjudicate.
3. Commit the in-progress work and the note. Header references the task number/title with a ` (BLOCKED)` suffix.

Block when any of these hold:

- Validation fails and the only fix lies outside the slice's `Scope` / `Must implement exactly`.
- The slice's `Done when` cannot be met without violating another slice's contract or the spec.
- You catch yourself contradicting earlier reasoning to force a fit.
- The task index YAML is malformed (e.g. `blocked_by` cites a task id that does not exist).
- Reviewer feedback would require work outside the chosen slice and the slice cannot honestly be marked `complete` without it.

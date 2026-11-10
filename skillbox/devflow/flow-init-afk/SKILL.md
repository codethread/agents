---
name: flow-init-afk
description: Focussed instruction set for scripted AFK loop
argument-hint: provide active feature folder, proposal, task index, feature plan, and selected task slice
disable-model-invocation: true
---

# Single-slice implementation prompt

Study the arguments supplied with this skill invocation.

Your job: complete the **selected task slice** included below, end-to-end, then stop.

The selected task is included below. Do not choose a different task. If the selected task is `status: pending`, start it. If it is `status: in_progress`, continue from the current worktree state and feature plan notes.

The prompt arguments must identify the active feature folder, proposal file, task index file, and feature plan file. Resolve the selected task's `task_file` relative to the active feature folder.

## Workflow

1. Load the `robustness` skill before making implementation decisions, and apply it when handling edge cases, failure modes, validation, or review feedback.
2. If the selected slice is `status: pending`, change it to `status: in_progress` in the provided task index file. If it is already `status: in_progress`, continue from the current worktree state and feature plan notes.
3. Read the selected slice's `task_file`, the provided proposal file, the provided feature plan file, and any root or feature-local specs referenced by them before implementing.
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

If you cannot honestly mark the slice `complete`, stop and reply `BLOCKED`. Do not improvise around the obstacle.

When replying `BLOCKED`:

1. Change the slice status to `blocked`. Do **not** revert to `pending`. Do **not** mark `complete`.
2. Append a concise blocker note to the feature plan file under `Developer Notes` so the user or a human-in-the-loop agent can adjudicate.
3. Commit the in-progress work and the note. Header references the task number/title with a ` (BLOCKED)` suffix.

Reply `BLOCKED` when any of these hold:

- Validation fails and the only fix lies outside the slice's `Scope` / `Must implement exactly`.
- The slice's `Done when` cannot be met without violating another slice's contract or the spec.
- You catch yourself contradicting earlier reasoning to force a fit.
- The task index YAML is malformed (e.g. `blocked_by` cites a task id that does not exist).
- Reviewer feedback would require work outside the chosen slice and the slice cannot honestly be marked `complete` without it.

Reply `NO_TASKS_REMAIN` only if the preselected task is missing or cannot be reconciled with the task index.

## Output contract

If the task is blocked, reply with `BLOCKED`.

If the selected task is missing or cannot be reconciled with the task index, reply with `NO_TASKS_REMAIN`.

Otherwise, reply with a terse summary of the completed work. Do not include the literal tokens `BLOCKED` or `NO_TASKS_REMAIN` in a success summary.

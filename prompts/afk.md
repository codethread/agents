---
description: Focussed instruction set for AFK ralph loop
argument-hint: provide the task index YAML, task files, and any specs to study
---

# Single-slice implementation prompt

Study $ARGUMENTS

Your job: complete **exactly one** approved task, end-to-end, then stop.

## Slice selection

Pick **exactly one** slice from the task index YAML using these rules:

1. The task index YAML is the source of truth for task status and blockers.
2. A slice is eligible only if:
   - `status: pending`
   - every task id listed in `blocked_by` has `status: complete`
3. If multiple slices are eligible, pick the **lowest-numbered** slice by `id`.
4. Do **not** work on more than one slice in a run.
5. Do **not** start a blocked slice.

## Workflow

1. Change the chosen slice in the task index YAML from `status: pending` to `status: in_progress`.
2. Implement the slice fully, following:
   - its `Scope`
   - its `Must implement exactly`
   - its `Done when`
   - all repo/package rules in `AGENTS.md`
3. Update all required code, tests, command help, and docs for that slice.
4. Run the project validation required by the repo rules.
5. If validation fails, fix it. Assume the tree was green before your edits — do not attribute failures to pre-existing state. If the only fix lies outside the slice's scope, see **Failure handling**.
6. When the slice is fully complete, update the task index YAML:
   - change `status: in_progress` to `status: complete`
7. Commit with detailed status including the task number and title as the commit header
   1. Request a subagent review, ensure you pass in the task you were working against and any relevant specs, along with your commit to show the changed code
   2. Handle the review comments
      - NOTE: the reviewer will likely over-specify correctness
      - use your judgment to move toward working software, and capture edge cases needing later robustness checks in the slice notes rather than expanding scope.
   3. Repeat until the important reviewer comments are addressed.
   4. Amend the previous commit so one commit matches the single task.
8. Stop. Do not begin another slice.

## Boundaries

- Stay within the chosen slice.
- Do not pre-implement future slices unless strictly required to complete the chosen slice’s published contract.
- Do not weaken tests or contracts to make validation pass.
- Fail loudly. Never silently retry, work around a problem, or hide partial work.

## Failure handling

If you cannot honestly mark the slice `complete`, stop and reply `BLOCKED`. Do not improvise around the obstacle.

When replying `BLOCKED`:

1. Leave the slice at `status: in_progress`. Do **not** revert to `pending`. Do **not** mark `complete`.
2. Add or update `blocked_note` on the task index YAML entry with one or two sentences describing the obstacle so the user can adjudicate.
3. Commit the in-progress work and the note. Header references the task number/title with a ` (BLOCKED)` suffix. Skip the review subagent.

Reply `BLOCKED` when any of these hold:

- Validation fails and the only fix lies outside the slice's `Scope` / `Must implement exactly`.
- The slice's `Done when` cannot be met without violating another slice's contract or the spec.
- You catch yourself contradicting earlier reasoning to force a fit.
- The task index YAML is malformed (e.g. `blocked_by` cites a task id that does not exist).
- On entry, a slice is already `status: in_progress` from a prior run — do **not** auto-resume; surface it.
- Reviewer feedback would require work outside the chosen slice and the slice cannot honestly be marked `complete` without it.

Reply `NO_TASKS_REMAIN` when no pending slice exists, **or** every pending slice has at least one incomplete `blocked_by` dependency (queue-wide deadlock counts here).

## Output contract

Reply with **exactly one** of these tokens and nothing else:

- `COMPLETE` — chosen slice fully implemented, validated, reviewed, and committed.
- `BLOCKED` — see **Failure handling**.
- `NO_TASKS_REMAIN` — see **Failure handling**.

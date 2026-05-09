---
description: Focussed instruction set for AFK ralph loop
argument-hint: provide the tasks file, and any specs to study
---

# Single-slice implementation prompt

Study $ARGUMENTS

Your job: complete **exactly one** approved task, end-to-end, then stop.

## Slice selection

Pick **exactly one** slice from the tasks file using these rules:

1. A slice is eligible only if:
   - `**Status:** pending`
   - every slice listed in `**Blocked by:**` has `**Status:** complete`
2. If multiple slices are eligible, pick the **lowest-numbered** slice.
3. Do **not** work on more than one slice in a run.
4. Do **not** start a blocked slice.

## Workflow

1. change the chosen slice from `**Status:** pending` to `**Status:** in_progress`.
2. Implement the slice fully, following:
   - its `Scope`
   - its `Must implement exactly`
   - its `Done when`
   - all repo/package rules in `AGENTS.md`
3. Update all required code, tests, command help, and docs for that slice.
4. Run the project validation required by the repo rules.
5. If validation fails, fix it. Assume the tree was green before your edits — do not attribute failures to pre-existing state. If the only fix lies outside the slice's scope, see **Failure handling**.
6. When the slice is fully complete, update the task file:
   - change `**Status:** in_progress` to `**Status:** complete`
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

1. Leave the slice at `**Status:** in_progress`. Do **not** revert to `pending`. Do **not** mark `complete`.
2. Append a `**Blocked note:**` line under the slice (one or two sentences) describing the obstacle so the user can adjudicate.
3. Commit the in-progress work and the note. Header references the task number/title with a ` (BLOCKED)` suffix. Skip the review subagent.

Reply `BLOCKED` when any of these hold:

- Validation fails and the only fix lies outside the slice's `Scope` / `Must implement exactly`.
- The slice's `Done when` cannot be met without violating another slice's contract or the spec.
- You catch yourself contradicting earlier reasoning to force a fit.
- The tasks file is malformed (e.g. `**Blocked by:**` cites a slice that does not exist).
- On entry, a slice is already `**Status:** in_progress` from a prior run — do **not** auto-resume; surface it.
- Reviewer feedback would require work outside the chosen slice and the slice cannot honestly be marked `complete` without it.

Reply `NO_TASKS_REMAIN` when no pending slice exists, **or** every pending slice has at least one incomplete `**Blocked by:**` (queue-wide deadlock counts here).

## Output contract

Reply with **exactly one** of these tokens and nothing else:

- `COMPLETE` — chosen slice fully implemented, validated, reviewed, and committed.
- `BLOCKED` — see **Failure handling**.
- `NO_TASKS_REMAIN` — see **Failure handling**.

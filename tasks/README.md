# AFK Flow Smoke Test

## Problem statement / MVP goal

Kick the tyres on the AFK loop with three minimal hello-world tasks that chain together. No real product goal — the purpose is to exercise the task runner end-to-end.

## Important references

- `tasks/index.yml` — machine-readable task queue
- Working directory: `/Users/adamhall/dev/projects/agents`

## Task strategy

Three purely AFK slices, each building on the previous:

1. **Task 1** — create a standalone script that prints a hardcoded greeting.
2. **Task 2** — extend it to accept a name via a CLI argument.
3. **Task 3** — extend it further to track and display a running count of greetings.

No HITL slices are required; every decision is deterministic and the acceptance criteria are unambiguous.

## Developer Notes

Append notes here. Do not rewrite earlier notes.

### Task plan created — 2026-06-01

- Purely a smoke test. Language choice is left to the agent for task 1; tasks 2 and 3 must use whatever was chosen in task 1.

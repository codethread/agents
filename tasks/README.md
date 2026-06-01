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

### Task 1 complete — 2026-06-01

- Created `hello.ts` at repo root; invocable via `node hello.ts`.
- Node 24 runs `.ts` files natively (type stripping) — no tsx or ts-node required.
- Tasks 2 and 3 should extend `hello.ts` with CLI args and a counter.

### Task 2 complete — 2026-06-01

- Extended `hello.ts` with `process.argv[2] ?? "World"` — parses name at the CLI boundary, explicit default.
- `node hello.ts Alice` → `Hello, Alice!`; `node hello.ts` → `Hello, World!`.
- Task 3 can extend `hello.ts` to add a greeting counter on top of this.

### Task 1 re-implemented — 2026-06-01

- A prior wip commit deleted `hello.ts` and reset tasks 1/2 to pending, restarting the smoke test.
- Created `hello.ts` at repo root using Node 24 native TypeScript (type stripping); shebang + single `console.log`.
- Invocable via `node hello.ts` or `./hello.ts`; prints exactly `Hello, World!`, exits 0.
- Tasks 2 and 3 should extend this file with CLI arg and counter respectively.

### Task 3 complete — 2026-06-01

- Extended `hello.ts` to persist a counter in `.hello_count` (same directory as the script).
- ENOENT on first run is recovered explicitly (returns 0); other read errors propagate loudly.
- Added `.hello_count` to `.gitignore` — it's a runtime artifact, not source.
- `node hello.ts` → `Hello, World!\nGreeted 1 time(s).`; subsequent runs increment the persisted count.

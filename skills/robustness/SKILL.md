---
name: robustness
description: |
  Guidance on how to write 'robust enough' software.
  TRIGGER when: handling review comments on edge cases or failure modes,
  also when deciding fallback code or graceful failure conditions.
  SKIP when: writing happy path scenarios, or following direct guidance to fix a bug.
metadata:
  intent: >-
    LLMs reach for production-grade error handling even when the task is
    "hello world". This skill is the decision procedure for when to stop.
---

# Writing Robust 'enough' code

When addressing review feedback or considering edge cases, place the failure on this matrix:

| How likely | small impact | critical error |
| ---------- | ------------ | -------------- |
| unlikely   | ignore it    | raise it       |
| likely     | raise it     | handle it      |

## What the actions mean

- **ignore it** — delete the guard. Trust the type system, the framework, and code you control. This is the cell LLMs violate most.
- **raise it** — surface the decision to a human; do not write defensive code. Let existing failures propagate naturally (no new `try/catch`, fallback, or retry). Interactive: ask before continuing. Headless: proceed on the happy path and note the risk in the final report. A `try/catch` that just logs is _not_ raising — it is silently handling.
- **handle it** — write recovery or fail-loud code. Defensive checks, fallbacks, and retries belong only here.

Better to raise it and let the user decide than to assume you must handle it.

## Examples by quadrant

### unlikely + small → ignore

- null check on a value your function just constructed
- try/catch around a pure, in-memory helper
- fallback for a required config value already validated at startup
- retry on a synchronous local operation
- input validation on arguments passed only by your own code
- race where the losing branch fails harmlessly (e.g., concurrent submit hits a unique constraint and the user retries; double-clicked button → second request 409s)

### unlikely + critical → raise

- a one-off migration whose idempotency is uncertain
- third-party API might return a new schema variant during a refactor
- ambiguous concurrency: two writers theoretically possible, never observed

### likely + small → raise

- network call may time out — retry policy is a product decision
- user input could be empty — UX response belongs to the user

### likely + critical → handle

- payment gateway returns failure → roll back and surface
- file write fails mid-stream → don't leave corrupted output
- auth token expires mid-request → refresh or fail loudly

## Fail loudly, parse at the boundary

A complementary technique that reduces how often this matrix matters: push validation to the edges.

- **Parse at the I/O boundary.** When data crosses in from outside (env, file, network, user input), parse it once into a typed shape. Reject malformed input there, not three calls deep.
- **Fail loudly on missing values.** Don't default silently. `port = env.PORT ?? 8080` hides a misconfigured deployment until 3am; `port = required(env.PORT)` crashes at startup, which is where you want it. If a default genuinely exists, encode it on the parsed type so it's visible, not buried at a call site.
- **Pass parsed shapes through, not raw values.** Functions accept `Config`, not `string`. The interior trusts the type — no re-checking, no re-parsing.
- **Parse, don't validate.** Make invalid states unrepresentable. Once a value lives in the type, the entire interior collapses into the `ignore it` cell.

## What counts as critical

- loss of funds
- corrupted or lost user data
- harm to user wellbeing
- breached security boundary

---
name: robustness
description: |
  Guidance on how to write robust-enough software without defensive noise.
  TRIGGER when: handling review comments about edge cases, failure modes,
  fallback behavior, graceful degradation, retries, validation, or error handling.
  SKIP when: making a purely happy-path change with no new failure behavior.
metadata:
  intent: >-
    LLMs reach for production-grade error handling even when the task is
    "hello world". This skill is the decision procedure for when to stop,
    when to escalate, and when to handle failure explicitly.
---

# Writing Robust Enough Code

Robust code is not code with guards everywhere. Robust code makes failure behavior intentional, visible, and proportionate.

Use this skill when deciding whether to add validation, fallback behavior, retries, `try/catch`, null checks, defensive guards, or graceful failure paths.

## Knowledge

### Action vocabulary

Use these actions precisely:

- **Ignore** — delete the proposed guard or fallback. Trust the type system, framework, and code you control. Do not add code.
- **Escalate** — surface the decision to a human instead of inventing policy. Interactive: ask before continuing. Headless: make the smallest happy-path change and report the unresolved decision point. Do not add defensive behavior just to continue.
- **Fail loudly** — make the failure immediate, visible, and traceable. Throw, reject, crash at startup, or let the existing exception propagate. Do not catch-and-log then continue.
- **Recover explicitly** — implement deliberate recovery: rollback, retry, refresh, compensate, or return a defined error state. Recovery must be observable and tied to intended behavior.

### Failure classification matrix

Classify the failure by likelihood and impact if unhandled:

| Likelihood of failure | Low/local impact | Critical/irreversible impact |
| --------------------- | ---------------- | ---------------------------- |
| Unlikely              | Ignore           | Escalate or fail loudly      |
| Likely                | Escalate policy  | Recover explicitly           |

Prefer escalation over inventing behavior. Prefer fail-loud behavior over silent defaults.

### What counts as critical impact

- loss of funds
- corrupted or lost user data
- harm to user wellbeing
- breached security boundary
- irreversible external side effect

### Parse at the boundary

Reduce defensive code by validating where data enters the system.

- **Parse at the I/O boundary.** When data crosses in from env, files, network, CLI args, database rows, or user input, parse it once into a typed shape.
- **Fail loudly on missing required values.** `port = env.PORT ?? 8080` hides misconfiguration. `port = required(env.PORT)` fails at startup, where the problem is traceable.
- **Represent real defaults explicitly.** If a default is product behavior, encode it in the boundary parser or config type, not deep in a call site.
- **Pass parsed shapes through the interior.** Functions accept `Config`, not raw strings. Interior code should not re-parse or re-validate trusted values.
- **Make invalid states unrepresentable.** Once a value lives in the type, downstream code usually belongs in the `Ignore` cell.

## Decisions

Entry state: CLASSIFY_SOURCE

### CLASSIFY_SOURCE

- guard: value comes from env, file, network, CLI, database, user input, subprocess output, or third-party API
  → PARSE_BOUNDARY
- guard: value is constructed by current code, already parsed, or enforced by a trusted type/schema
  → CLASSIFY_FAILURE

### PARSE_BOUNDARY

- action: parse once at the boundary into a typed/domain shape
- guard: malformed boundary input has no defined recovery behavior
  → FAIL_LOUDLY
- guard: malformed boundary input has defined recovery behavior
  → RECOVER_EXPLICITLY
- guard: parsed value is passed to interior code
  → CLASSIFY_FAILURE

### CLASSIFY_FAILURE

Use the failure classification matrix.

- guard: unlikely failure and low/local impact
  → IGNORE
- guard: unlikely failure and critical/irreversible impact
  → ESCALATE_OR_FAIL_LOUDLY
- guard: likely failure and low/local impact
  → ESCALATE_POLICY
- guard: likely failure and critical/irreversible impact
  → RECOVER_EXPLICITLY

### IGNORE

- action: remove the proposed defensive code, or do not add it
- terminal state

### ESCALATE_POLICY

- action: ask the user/product owner what behavior is desired
- headless action: proceed only with the happy-path implementation and report the unresolved decision point
- terminal state unless user gives policy

### ESCALATE_OR_FAIL_LOUDLY

- guard: behavior is a user/product/domain policy decision
  → ESCALATE_POLICY
- guard: no policy is needed because existing failure is clear and traceable
  → FAIL_LOUDLY

### FAIL_LOUDLY

- action: throw, reject, crash at startup, return an explicit error, or let the existing exception propagate
- terminal state

### RECOVER_EXPLICITLY

- action: implement the intended recovery path: rollback, retry, refresh, compensate, or return a defined error state
- guard: recovery policy is unclear
  → ESCALATE_POLICY
- guard: recovery is implemented and observable
  → DONE

### DONE

- terminal state

## Procedures

When considering robustness code:

1. Identify the value or operation that might fail.
2. Decide whether it is external boundary data or trusted interior data.
3. If boundary data, parse once at entry and pass a typed shape inward.
4. Classify the failure by likelihood and impact.
5. Choose exactly one action: ignore, escalate, fail loudly, or recover explicitly.
6. Delete guards that protect impossible states in trusted interior code.
7. Avoid changing product behavior unless the user gave that policy.
8. If handling failure, make the behavior visible in control flow: throw, return an explicit error, retry with policy, rollback, or compensate.

## Examples

### Ignore

- null check on a value your function just constructed
- `try/catch` around a pure in-memory helper
- fallback for required config already parsed at startup
- retry on a synchronous local operation
- validation on arguments passed only by trusted code
- harmless race where the losing branch naturally fails and the user can retry

### Escalate

- retrying a network timeout when no retry policy exists
- deciding whether empty user input should show an error, disable submit, or auto-fill
- ambiguous third-party API variant during a refactor
- uncertain idempotency for a one-off migration
- theoretical two-writer race with unclear product impact

### Fail loudly

- missing required env var at startup
- impossible enum variant after exhaustive parsing
- malformed local config with no safe default
- failed invariant in code you control

### Recover explicitly

- payment capture fails after reservation: roll back or compensate
- file write fails mid-stream: avoid leaving corrupted output
- auth token expires mid-request: refresh or return an auth error
- external API rate-limits a job with a defined retry/backoff policy

## Constraints

- Never add a silent fallback for missing required data.
- Never catch-and-log without changing control flow.
- Never retry without an explicit retry policy.
- Never re-validate trusted interior data just because it could theoretically be invalid.
- Never bury defaults deep in call sites; defaults belong in boundary parsing or domain config.
- Never turn an unclear product decision into invented agent behavior.

## Validation

Before finishing, check:

- [ ] External inputs are parsed at the boundary.
- [ ] Trusted interior code does not contain defensive noise.
- [ ] Missing required values fail loudly, not silently default.
- [ ] Any recovery path is explicit, observable, and policy-backed.
- [ ] No `try/catch` merely logs and continues.
- [ ] Any unclear behavior was escalated or reported as unresolved.

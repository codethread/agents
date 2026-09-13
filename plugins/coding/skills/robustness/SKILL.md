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

# Writing robust enough code

Make failure behavior intentional, visible, and proportionate—not guarded everywhere.

## Parse at the boundary

Identify the value or operation that might fail, then distinguish external inputs from trusted interior data:

```text
External input? -- yes --> Parse once into a typed/domain shape
  |                         |
  no                        v
  |                       Invalid? -- yes --> Defined recovery or fail loudly
  |                         |
  |                         no
  v                         v
Choose an action by likelihood and impact
```

- Parse env, files, network, CLI args, database rows, user input, subprocess output, and third-party API data at entry.
- Fail loudly on malformed input without defined recovery, or on missing required values. `port = env.PORT ?? 8080` hides missing required config; `port = required(env.PORT)` fails traceably at startup.
- Encode genuine product defaults in the boundary parser or config type, never deep in call sites.
- Pass parsed shapes inward: accept `Config`, not raw strings. Make invalid states unrepresentable; do not re-parse or re-validate values constructed by trusted code or enforced by trusted types/schemas.

## Choose one action

Classify the failure by likelihood and impact **if unhandled**:

| Likelihood | Low/local impact | Critical/irreversible impact |
| ---------- | ---------------- | ---------------------------- |
| Unlikely   | Ignore           | Escalate or fail loudly      |
| Likely     | Escalate policy  | Recover explicitly           |

Critical impact includes lost funds, corrupted or lost user data, harm to wellbeing, a breached security boundary, or an irreversible external side effect.

- **Ignore:** remove or omit the proposed guard/fallback. Trust the type system, framework, and code you control; do not protect impossible interior states.
- **Escalate:** ask the user/product owner before continuing when behavior needs a policy decision. In headless mode, make only the smallest happy-path change and report the unresolved decision. Do not invent defensive behavior to continue.
- **Fail loudly:** throw, reject, crash at startup, return an explicit error, or let the existing exception propagate. Make failure immediate, visible, and traceable; never catch-and-log then continue.
- **Recover explicitly:** implement intended rollback, retry, refresh, compensation, or a defined error state. Make recovery observable in control flow. Never retry without an explicit policy; if recovery policy is unclear, escalate.

Prefer escalation to invented product behavior and loud failure to silent defaults. For unlikely but critical failures, escalate policy decisions; otherwise fail loudly when the existing failure is clear and traceable.

## Examples

**Ignore**

- Null check on a value your function just constructed.
- `try/catch` around a pure in-memory helper.
- Fallback for required config already parsed at startup.
- Retry on a synchronous local operation.
- Validation on arguments passed only by trusted code.
- Harmless race where the losing branch naturally fails and the user can retry.

**Escalate**

- Network timeout with no retry policy.
- Empty input that could show an error, disable submit, or auto-fill.
- Ambiguous third-party API variant during a refactor.
- Uncertain idempotency for a one-off migration.
- Theoretical two-writer race with unclear product impact.

**Fail loudly**

- Missing required env var at startup.
- Impossible enum variant after exhaustive parsing.
- Malformed local config with no safe default.
- Failed invariant in code you control.

**Recover explicitly**

- Payment capture fails after reservation: roll back or compensate.
- File write fails mid-stream: avoid leaving corrupted output.
- Auth token expires mid-request: refresh or return an auth error.
- External API rate-limits a job: apply its defined retry/backoff policy.

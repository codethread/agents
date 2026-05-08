---
name: writing-tests
description: |
  Decide whether and how to write tests: when a test earns its keep, what to cover,
  what to leave to the type system or schemas, and how to lean on surrounding patterns.
  TRIGGER when: user asks to add/write tests, cover code with tests, or create a new
  test file; agent is about to author a test without an obvious neighbour to copy.
  SKIP when: editing an existing test that already follows a clear local pattern —
  mirror the pattern instead.
metadata:
  intent: >-
    Less shitty tests, not suitable for mission critical systems (health/finance)
---

# Writing tests

Before writing any test, apply this gate:

> If this test wasn't written, how quickly could we identify and fix the bug it would have caught anyway?

If the answer is not "hours, with severe consequences", you probably don't need it.

## Process

1. Search nearby tests and tests on similar shapes — prior art wins
2. Apply the gate above
3. Consult the decision matrix below
4. If still uncertain, flag missing coverage and ask the user — do not author autonomously

## Principles

- Good tests are very hard to write — only add the ones that earn their keep
- Under-specify and add tests later, rather than over-constrain the system up front
- Your training is not well suited to good test authoring; favour surrounding code patterns over intrinsic knowledge

## Decision matrix

| Test type | No similar tests                 | Strong existing patterns      |
| --------- | -------------------------------- | ----------------------------- |
| Pure      | Write fast efficient test tables | Mirror prior art              |
| Impure    | Don't write tests                | Mirror with minimal new tests |

**Why no tests for impure code?** You are bad at it, better to raise it as missing test coverage and seek guidance than to write poor tests autonomously.

## What to test

### Pure transformations

- strings: snapshot tests — only when the string itself is the contract; review diffs deliberately or you are rubber-stamping
- complex data transformations: table-driven tests over input → expected shape
- date manipulation: cover DST, timezones, month-end, leap years; inject "now", never read the clock directly
- parsers, lexers, regex: edge-case tables (empty, malformed, unicode, very long)
- numeric / money / units: rounding, overflow, negative zero, off-by-one
- serialisation: round-trip property `decode(encode(x)) == x`
- finite-state machines: enumerate legal transitions and assert illegal ones reject

### Impure

- favour dependency injection wherever possible — the test boundary is the interface, not the call site
- timing bugs: virtual clock and deterministic schedulers; never `sleep` in a test
- I/O: prefer real tmp filesystems and in-memory DBs over hand-rolled mocks unless robust Fake systems are provided already
- network: record/replay or a stub server; never hit the live service
- error paths: inject failures via DI rather than monkey-patching
- concurrency: if you cannot make it deterministic, do not fake it — flag it and escalate

## What NOT to test

- ANYTHING that can be better expressed in the type system
- ANYTHING that can be better expressed in IO schemas

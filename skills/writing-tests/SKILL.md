---
name: writing-tests
description: |
  Decide whether and how to write tests: when a test earns its keep, what to cover,
  what to leave to the type system or schemas, and how to lean on surrounding patterns.
  TRIGGER whenever authoring a new test or test file, adding test cases to an existing
  file, covering code with tests, writing a regression test for a bug fix, or about to
  create test scaffolding/fixtures/mocks — unless the user has given clear direction on
  exactly what to test (specific cases, assertions, or boundaries named).
  SKIP only when: the user has spelled out the test cases to write, or editing an
  existing test that already follows a clear local pattern (mirror the pattern instead).
metadata:
  intent: >-
    Help agents add fewer, better tests. Suitable for ordinary application code;
    not sufficient guidance for mission-critical health, finance, or safety systems.
---

# Writing tests

Use this skill to decide whether to author tests, what kind to write, and when to ask instead of inventing a fragile harness.

## Knowledge

### Core gate

Add a test when it protects behavior that is likely to regress, hard to debug manually, user-visible, data/security-sensitive, or already broke once.

Do not add tests merely to increase coverage, assert implementation details, or duplicate guarantees already expressed better by the type system or runtime schemas.

### Good tests

Good tests assert observable behavior through stable boundaries. They are deterministic, small, and useful when they fail.

Prefer tests that would quickly answer: "what behavior broke?" Avoid tests that only answer: "which private helper changed?"

### Prior art wins

Nearby tests are stronger guidance than general advice. Match local style, fixtures, helpers, naming, and assertion granularity unless the existing pattern is clearly broken.

### Pure vs impure code

Pure code is usually safe for agents to test: parsers, formatters, reducers, renderers, classifiers, validators, serializers, and other input → output transformations.

Impure code is risky to test without an established harness: filesystem, network, database, timers, subprocesses, concurrency, editor/TTY behavior, global process state, and external services.

For impure code: mirror existing harnesses. Do not invent complex mocks, sleeps, monkey-patches, or live-service tests autonomously.

## Decisions

Entry state: CLASSIFY_CHANGE

### CLASSIFY_CHANGE

- guard: editing an existing test with a clear local pattern
  → MIRROR_PATTERN
- guard: fixing a bug
  → WRITE_REGRESSION_TEST
- guard: adding or changing pure transformation behavior
  → CONSIDER_PURE_TEST
- guard: adding or changing impure behavior with an established local test harness
  → MIRROR_PATTERN
- guard: adding or changing impure behavior without an established local test harness
  → ASK_USER
- guard: behavior is fully and better enforced by types or runtime schemas
  → DO_NOT_TEST
- guard: user explicitly requested tests and none of the above decide it
  → ASK_USER

### MIRROR_PATTERN

- action: copy the nearest relevant test shape and make the smallest meaningful addition
- guard: test can assert observable behavior deterministically
  → WRITE_TEST
- guard: test would require sleeps, live network, global monkey-patching, or broad implementation mocks
  → ASK_USER

### WRITE_REGRESSION_TEST

- action: write the smallest test that would have failed before the fix
- guard: regression can be captured through a stable public/module boundary
  → WRITE_TEST
- guard: regression requires a new impure harness or brittle implementation assertions
  → ASK_USER

### CONSIDER_PURE_TEST

- guard: behavior has edge cases, branching, parsing, formatting, serialization, arithmetic, or state transitions
  → WRITE_TEST
- guard: behavior is trivial and already guaranteed by types/schemas
  → DO_NOT_TEST
- guard: uncertain value
  → ASK_USER

### ASK_USER

- action: report the missing coverage and propose the safest test boundary
- terminal state: do not author the test autonomously

### DO_NOT_TEST

- action: skip test authoring and, if useful, mention why
- terminal state

### WRITE_TEST

- action: write the test using Procedures and Constraints
- terminal state

## Procedures

### Search for prior art

1. Search nearby test files first.
2. Search tests for similar code shapes: parser, renderer, CLI, filesystem, extension, session, etc.
3. Reuse existing helpers and fixture style.
4. If no relevant pattern exists for impure behavior, enter ASK_USER.

### Write a regression test

1. Identify the externally visible broken behavior.
2. Write the smallest setup that reproduces it.
3. Assert the corrected behavior, not the internal fix.
4. Prefer one focused regression test over broad new coverage.

### Write pure transformation tests

Use table-driven tests when multiple inputs share one behavior contract.

Good targets:

- strings: snapshot tests only when the string itself is the contract; review diffs deliberately
- complex data transformations: input → expected shape tables
- date manipulation: DST, timezones, month-end, leap years; inject `now`, never read the clock directly
- parsers, lexers, regex: empty, malformed, unicode, escaped, nested, and very long inputs
- numeric / money / units: rounding, overflow, negative zero, off-by-one, boundaries
- serialization: round-trip invariant, e.g. `decode(encode(x)) == x`
- finite-state machines: legal transitions and illegal transition rejection

### Write impure tests only with a safe harness

Use established local patterns for:

- timing: virtual clock or deterministic scheduler; never `sleep`
- filesystem: real temporary directories over hand-rolled mocks
- database: in-memory/test database only when already supported locally
- network: stub server or record/replay fixture; never hit a live service
- errors: inject failures through dependency injection or existing fakes
- concurrency: deterministic coordination only; if nondeterministic, ask

## Constraints

- Never add tests only for coverage numbers.
- Never assert private implementation details when observable behavior is available.
- Never hit live network services.
- Never use sleeps as synchronization.
- Never depend on wall-clock time; inject time or use a virtual clock.
- Never invent a large impure test harness without user approval.
- Do not duplicate guarantees better owned by TypeScript types or runtime schemas, except when testing the schema/boundary itself.
- Keep fixtures minimal and local to the behavior under test.

## Validation

Before reporting a new test as good, verify:

- [ ] It would fail for the bug or risk it claims to cover.
- [ ] It asserts observable behavior through a stable boundary.
- [ ] It follows nearby test style and helper conventions.
- [ ] It is deterministic: no live services, sleeps, wall-clock dependency, or race timing.
- [ ] It has minimal setup and clear expected output.
- [ ] Its failure would help locate the broken behavior faster than manual inspection.

# Task 2: Accept a name argument in the greeting

## Scope

Type: AFK

Extend the script created in task 1 so it accepts an optional name argument. When a name is supplied the greeting is personalised; when none is supplied it falls back to `World`.

## Must implement exactly

- Same file as task 1; no new files needed.
- When called with one positional argument (e.g. `./hello.sh Alice`) it prints `Hello, Alice!`.
- When called with no arguments it still prints `Hello, World!` (backward-compatible).
- Exit code is 0 in both cases.

## Done when

- `./hello.<ext> Alice` prints `Hello, Alice!`.
- `./hello.<ext>` prints `Hello, World!`.
- No other output or side effects.

## Out of scope

- Multiple names or flags.
- Error handling for extra arguments.
- Tests or CI wiring.

## References

- `tasks/001-hello-world-script.md` — the script this task extends.
- `tasks/README.md` — overall plan context.

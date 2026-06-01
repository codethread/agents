# Task 1: Create a hello world script

## Scope

Type: AFK

Create a minimal runnable script in the repo root that prints `Hello, World!` to stdout and exits 0. Language choice is up to the agent — pick whatever fits the repo's existing stack, or plain shell if there is no clear match.

## Must implement exactly

- A single script file at the repo root (e.g. `hello.sh`, `hello.py`, `hello.ts`).
- Running it with no arguments prints exactly `Hello, World!` followed by a newline.
- The script is executable (or invocable via its runtime with a single obvious command).

## Done when

- `./hello.<ext>` (or equivalent invocation) prints `Hello, World!` to stdout.
- Exit code is 0.
- No additional output or side effects.

## Out of scope

- Arguments, flags, or configuration.
- Tests or CI wiring.
- More than one file.

## References

- `tasks/README.md` — overall plan context.

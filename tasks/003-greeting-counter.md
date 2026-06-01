# Task 3: Add a greeting counter

## Scope

Type: AFK

Extend the script from tasks 1 and 2 to persist a running count of how many times it has been invoked. After printing the greeting, print a second line showing the total invocation count.

## Must implement exactly

- Persist the counter in a local file (e.g. `.hello_count`) in the same directory as the script.
- On each invocation, increment the counter by 1, then print it.
- Output format (two lines):
  ```
  Hello, <name>!
  Greeted 3 time(s).
  ```
- The count file is created automatically on first run (starts at 1).
- All behaviour from task 2 is preserved (optional name argument, fallback to `World`).

## Done when

- First run: prints `Hello, World!\nGreeted 1 time(s).`
- Second run with a name: prints `Hello, Alice!\nGreeted 2 time(s).`
- Counter persists across separate invocations (not just an in-memory variable).
- Exit code is 0.

## Out of scope

- Resetting the counter via a flag.
- Concurrent-safe file writes.
- Tests or CI wiring.

## References

- `tasks/002-named-greeting.md` — the script this task extends.
- `tasks/README.md` — overall plan context.

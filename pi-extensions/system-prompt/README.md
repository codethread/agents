# `system-prompt`

> Merged system-prompt extension that owns Pi's base scaffold and injects rendered rules plus project structure.

This package now loads a **single** `system-prompt` extension entrypoint from `pi-extensions/system-prompt/index.ts`. That root file owns all Pi flags, commands, and event hooks in one place. Internally it composes three behavior modules that used to load as separate extensions:

1. **Owned scaffold** — appends the package-owned built-in tool + guideline block inside `<system-reminder type="harness">` when Pi's default base prompt is not present.
2. **Dynamic template injection** — renders global `agent.njk` and nearest project `.pi/agent.njk` templates into `<system-reminder type="rules">` / `<system-reminder type="project-rules">`.
3. **Project structure snapshot** — appends a bounded repo tree inside `<system-reminder type="project-structure">`.

## Debug surfaces

- `--debug-prompt` — print the current effective prompt and exit; accepts optional JSON template-var overrides
- `/debug-prompt` — show the last materialized effective prompt in the UI; if no message has been sent yet, it warns the user to send one first

## Behavior docs

Implementation details still live alongside the behavior-specific modules, but their runtime wiring is centralized in `index.ts`:

- [`owned-system-prompt/README.md`](./owned-system-prompt/README.md)
- [`dynamic-agents-md/README.md`](./dynamic-agents-md/README.md)
- [`project-structure-prompt/README.md`](./project-structure-prompt/README.md)

Related context-management behavior:

- [`../context-management/pi-discovery/README.md`](../context-management/pi-discovery/README.md)

# `system-prompt`

> Prompt extension that owns Pi's base scaffold and injects rendered rules.

This package loads a `system-prompt` extension entrypoint from `pi-extensions/system-prompt/index.ts`. That root file owns all Pi flags, commands, and event hooks for two prompt-layer behaviors:

1. **Owned scaffold** — appends the package-owned built-in tool + guideline block inside `<system-reminder type="harness">` when Pi's default base prompt is not present.
2. **Dynamic template injection** — renders global `agent.njk` and nearest project `.pi/agent.njk` templates into `<system-reminder type="rules">` / `<system-reminder type="project-rules">`.

## Debug surfaces

- `--debug-prompt` — print the current effective system prompt and exit; accepts optional JSON template-var overrides
- `/debug-prompt` — show the last materialized effective system prompt in the UI; if no message has been sent yet, it warns the user to send one first

## Behavior docs

Implementation details still live alongside the behavior-specific modules:

- [`owned-system-prompt/README.md`](./owned-system-prompt/README.md)
- [`dynamic-agents-md/README.md`](./dynamic-agents-md/README.md)

Related messaging behavior:

- [`../messaging/project-structure/README.md`](../messaging/project-structure/README.md)

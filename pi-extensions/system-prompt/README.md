# `system-prompt`

> Prompt extension that owns Pi's effective system prompt and injects rendered rules.

This package loads a `system-prompt` extension entrypoint from `pi-extensions/system-prompt/index.ts`. That root file owns all Pi flags, commands, and event hooks for two prompt-layer behaviors:

1. **Owned prompt replacement** — replaces Pi's generated prompt during `before_agent_start` using structured `systemPromptOptions` for identity, tool metadata, skills, context files, append text, date, and cwd.
2. **Tool-oriented rendering** — renders tool metadata tool-by-tool, with each tool's guidelines under its own entry and the subagent catalog nested under the `subagent` tool.
3. **Dynamic template injection** — renders global `agent.njk` and nearest project `.pi/agent.njk` templates into `<system-reminder type="rules">` / `<system-reminder type="project-rules">` before passing them to the owned prompt builder.

## Debug surfaces

- `--debug-prompt` — print the current effective system prompt and exit; accepts optional JSON template-var overrides
- `/debug-prompt` — show the last materialized effective system prompt in the UI; if no message has been sent yet, it warns the user to send one first

## Behavior docs

Implementation details still live alongside the behavior-specific modules:

- [`owned-system-prompt/README.md`](./owned-system-prompt/README.md)
- [`dynamic-agents-md/README.md`](./dynamic-agents-md/README.md)

Related messaging behavior:

- [`../messaging/project-structure/README.md`](../messaging/project-structure/README.md)

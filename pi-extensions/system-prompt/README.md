# `system-prompt`

> Prompt extension that owns Pi's effective system prompt and injects rendered rules.

This directory is intentionally flat:

- `index.ts` — Pi flags, commands, event hooks, and tool-guideline grouping
- `prompt-builder.ts` — pure system-prompt rendering helpers
- `templates.ts` — `agent.njk` discovery/rendering plus `--debug-prompt` override parsing

## Behavior

The extension replaces Pi's generated prompt during `before_agent_start` using structured `systemPromptOptions` for identity, tool metadata, skills, context files, append text, date, and cwd.

It also renders Nunjucks rule templates into the owned prompt:

1. global template: `<PI_CODING_AGENT_DIR>/agent.njk`
2. nearest project template: `.pi/agent.njk` walking upward from cwd

If both exist, both are rendered as separate XML blocks: global inside `<system-reminder type="rules">`, project inside `<system-reminder type="project-rules">`.

## Template variables

Templates receive:

- `provider`, `model`, `cwd`, `hasUI`
- `isMainAgent` / `isSubagent`, derived from `PI_SUBAGENT=1`
- `tools` — Pi's selected tool names for the turn
- all environment variables

Custom helpers:

- `regex_test(pattern)` — tests a string against a regex; supports `~/` expansion
- `has_tools(toolOrTools)` — true when all requested tools are active; accepts a string or string array

Example:

```jinja
{% if provider == "anthropic" %}
Prefer XML-style structured output.
{% endif %}

{% if has_tools(["read", "edit", "write"]) %}
Prefer precise file-edit tools over shell redirection.
{% endif %}
```

## Debug surfaces

- `--debug-prompt` — print the next materialized effective system prompt and exit; send a message manually (for example with `--print ping`); accepts optional JSON template-var overrides
- `/debug-prompt` — show the last materialized effective system prompt in the UI; if no message has been sent yet, it warns the user to send one first

Example:

```bash
pi --debug-prompt --print ping '{"model":"claude-sonnet"}'
```

Related messaging behavior: [`../messaging/project-structure/README.md`](../messaging/project-structure/README.md)

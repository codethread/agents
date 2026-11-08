# `system-prompt`

> Prompt extension that owns Pi's effective system prompt and injects rendered rules.

This directory is intentionally flat:

- `index.ts` — prompt composition and lifecycle wiring
- `prompt-builder.ts` — pure system-prompt rendering helpers
- `templates.ts` — `agent.njk` discovery/rendering plus `--debug-prompt` override parsing
- `tool-report.ts` — `--debug-tools` selector parsing and report rendering

## Behavior

The extension renders its persona and named prompt sections during `before_agent_start` for both user- and custom-message runs through Pi's structured `systemPromptOptions`, rather than returning a full `systemPrompt` replacement. It owns the tool metadata, rules, skills, context files, append text, date, and cwd sections while preserving additional sections contributed by other extensions, such as Botlake's `botlake`, regardless of load order. Pi wraps named sections in XML tags and can publish their changes as transcript deltas. An extension that returns a full `systemPrompt` replacement bypasses this composition and must preserve contributions itself.

It also loads `CLAUDE.local.md` from the cwd and each ancestor, ordered from the filesystem root toward the cwd, and appends those files after Pi's discovered `AGENTS.md`/`CLAUDE.md` context files.

It also renders Nunjucks rule templates into the owned prompt:

1. global template: `<PI_CODING_AGENT_DIR>/agent.njk`
2. nearest project template: `.pi/agent.njk` walking upward from cwd

Templates are discovered, read, and rendered once at session startup, alongside Pi's other prompt resources. Template failures surface at startup. `/reload` starts the lifecycle again, so template edits take effect after a reload or a new session rather than on the next turn.

If both exist, both are rendered as separate XML blocks: global inside `<system-reminder type="rules">`, project inside `<system-reminder type="project-rules">`.

The owned prompt also includes a stable `<system-reminder type="project-rules">` instruction explaining that project-rule reminders may be injected automatically when matching files are mentioned or read. Agents are told to apply those reminders silently, not acknowledge or summarize them, and continue the assigned task.

## Template variables

Templates receive:

- `provider`, `model`, `cwd`, `hasUI`
- `tools` — Pi's active tool names at session startup
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
- `--debug-tools [tool,...]` — print all registered tools, or selected tools, with active status, their approximate system-prompt contribution, and provider-neutral model definition; exits before a model request

Example:

```bash
pi --debug-prompt --print ping '{"model":"claude-sonnet"}'
pi --debug-tools bash,ls
```

Related messaging behavior:

- [`../messaging/project-structure/README.md`](../messaging/project-structure/README.md)
- [`../messaging/project-rules/README.md`](../messaging/project-rules/README.md)

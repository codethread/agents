# `dynamic-agents-md`

> Render a Nunjucks template into the system prompt.

Searches upward from `cwd` for a template file and appends the rendered result to the system prompt. Each rendered section is wrapped in its own `<system-reminder type="...">` block so prompt prose stays visually and semantically separated from neighboring injections.

**Template locations (checked in order):**

1. `.pi/agent.njk` — project-scoped (nearest ancestor)
2. `~/.pi/agent/agent.njk` — global (user-scoped fallback)

If both exist, both are rendered as separate XML blocks: global inside `<system-reminder type="rules">...</system-reminder>`, project inside `<system-reminder type="project-rules">...</system-reminder>`.

**Template variables:**

| Variable            | Type       | Description                                           |
| ------------------- | ---------- | ----------------------------------------------------- |
| `provider`          | `string`   | Current AI provider (e.g. `"anthropic"`, `"openai"`)  |
| `model`             | `string`   | Current model ID (e.g. `"claude-sonnet-4-20250514"`)  |
| `cwd`               | `string`   | Current working directory                             |
| `hasUI`             | `boolean`  | Whether Pi has an interactive UI                      |
| `isMainAgent`       | `boolean`  | `true` for the top-level agent, `false` for subagents |
| `isSubagent`        | `boolean`  | `true` when running inside a delegated subagent       |
| `tools`             | `string[]` | Currently active tool names                           |
| `HOME`, `PATH`, ... | `string`   | All environment variables are available               |

**Nunjucks syntax examples:**

```jinja
{# Conditionally include rules based on the model #}
{% if provider == "anthropic" %}
Prefer XML-style structured output.
{% endif %}

{# Vary instructions based on the working directory #}
{% if cwd | regex_test("my-project") %}
- Run `make test` before committing
- Use conventional commits
{% endif %}

{# Only include instructions when all required tools are available #}
{% if has_tools(["read", "write"]) %}
Prefer read-then-write workflows over shell redirection.
{% endif %}

{# Switch tone/output for the main agent vs delegated subagents #}
{% if isMainAgent %}
Address the user directly and explain tradeoffs.
{% else %}
Return terse, implementation-focused output for the parent agent.
{% endif %}

{# Filter form also works against the tools variable #}
{% if tools | has_tools(["read", "edit", "write"]) %}
You can safely propose direct file edits.
{% endif %}

{# Use environment variables #}
Project owner: {{ GIT_AUTHOR_NAME | default("unknown") }}
```

**Custom filters/helpers:**

- `regex_test(pattern)` — tests a string against a regex. Supports `~/` expansion.
- `has_tools(toolOrTools)` — returns `true` only when all requested tool names are currently active. Accepts a single string or an array of strings.

**Command:** `/debug-prompt` — opens the fully rendered system prompt in `$VISUAL`/`$EDITOR` for inspection.

**Flag:** `--debug-prompt` — prints the system prompt and exits (useful for CI/scripting).

You can also pass a JSON object to override template vars for debug rendering only:

```bash
pi --debug-prompt '{"model":"claude-sonnet"}'
```

These overrides are applied on top of the normal vars (`provider`, `model`, `cwd`, `hasUI`, `isMainAgent`, `isSubagent`, `tools`, env vars) only for the debug turn.

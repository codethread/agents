# Pi Extensions

Extensions for the [Pi Coding Agent](https://github.com/nichochar/pi-coding-agent), organized by type.

---

## Tools

### `subagent`

> Delegate tasks to specialized subagents with isolated context.

The agent is aware of this tool and will use it when asked to delegate work, run tasks in parallel, or chain multiple steps together. You can guide it by describing the kind of work you want delegated.

**How to use it:**

- _"Use the explorer agent to map out the folder structure"_
- _"Run these three tasks in parallel: lint, typecheck, and test"_
- _"First research the API with the api-researcher, then pass the findings to the dev agent to implement it"_

The agent can invoke subagents in three modes:

| Mode         | When to use                                            | What happens                              |
| ------------ | ------------------------------------------------------ | ----------------------------------------- |
| **Single**   | One focused task                                       | Spawns one agent process                  |
| **Parallel** | Independent tasks that can run at the same time        | Up to 8 tasks, 4 concurrent               |
| **Chain**    | Sequential pipeline where each step builds on the last | Output flows via `{previous}` placeholder |

**Creating agents:**

Agent files are markdown files with YAML frontmatter, placed in one of:

- `~/.pi/agent/agents/` — user-scoped, always available
- `.pi/agents/` — project-scoped, discovered from `cwd` upward

**Agent file format:**

```markdown
---
name: my-agent
description: Short description of what this agent does
tools: Read, Bash, Edit
model: sonnet
---

You are a specialist in [whatever]. Your job is to...
```

| Frontmatter field | Required | Description                                          |
| ----------------- | -------- | ---------------------------------------------------- |
| `name`            | ✅       | Agent identifier (used in tool calls)                |
| `description`     | ✅       | Shown to the parent agent for delegation decisions   |
| `tools`           |          | Comma-separated list of tools available to the agent |
| `model`           |          | Model alias or full `provider/model` identifier      |

The markdown body below the frontmatter becomes the agent's system prompt.

---

### `questionnaire`

> Structured question forms opened in your external editor.

The agent uses this tool automatically whenever it needs your input — clarification, choices, or confirmation. You don't need to ask for it; it's the agent's primary way of communicating back to you.

When invoked, a temporary `.md` file opens in `$VISUAL` (fallback `$EDITOR`) alongside a companion `session-tldr.md` transcript file referenced by a first-line HTML comment (`<!-- session-summary: /abs/path -->`). Each question renders rich option details separately from a compact `<user_response>` block. You answer by checking exactly one option; if you choose `Other:`, you write freeform text directly below that line.

If you leave invalid or missing answers, the form reopens with validation feedback and instructions. Saving an empty questionnaire buffer is treated as an explicit stop.

---

## UI Extensions

### `read-compact`

> Compact file read display — transparent to the user.

Replaces the default `read` tool renderer. File contents are hidden in the TUI (only the path is shown). Errors display simplified messages. The agent's behavior is unchanged — this is purely a display optimization.

---

### `bash-compact`

> Compact shell output display — transparent to the user.

Replaces the default `bash` tool renderer. Output is collapsed to 5 lines by default; press `Ctrl+o` to expand. Truncation notices are shown when output was clipped. The agent's behavior is unchanged.

---

### `current-context-footer`

> Persistent status bar — transparent to the user.

Renders a footer at the bottom of the TUI showing:

- Context token usage (color-coded: >70% ⚠️, >90% 🔴)
- Cumulative session cost
- Working directory, git branch, session name
- Active model and provider

---

## Lifecycle / Prompt Extensions

### `claude-sync`

> Synchronize Claude project context with Pi — transparent to the user.

On startup, walks upward from `cwd` to find the nearest `.claude/` directory and symlinks any `.md` files into the equivalent `.pi/` location. This lets Pi reuse Claude-authored project context automatically.

---

### `dynamic-agents-md`

> Render a Nunjucks template into the system prompt.

Searches upward from `cwd` for a template file and appends the rendered result to the system prompt. This is how project-specific rules, conventions, and instructions get injected into every conversation.

**Template locations (checked in order):**

1. `.pi/agent.njk` — project-scoped (nearest ancestor)
2. `~/.pi/agent/agent.njk` — global (user-scoped fallback)

If both exist, both are rendered: global under a `# Global rules` heading, project under `# Project rules`.

**Template variables:**

| Variable            | Type     | Description                                          |
| ------------------- | -------- | ---------------------------------------------------- |
| `provider`          | `string` | Current AI provider (e.g. `"anthropic"`, `"openai"`) |
| `model`             | `string` | Current model ID (e.g. `"claude-sonnet-4-20250514"`) |
| `cwd`               | `string` | Current working directory                            |
| `HOME`, `PATH`, ... | `string` | All environment variables are available              |

**Nunjucks syntax examples:**

```njk
{# Conditionally include rules based on the model #}
{% if provider == "anthropic" %}
Prefer XML-style structured output.
{% endif %}

{# Vary instructions based on the working directory #}
{% if cwd | regex_test("my-project") %}
- Run `make test` before committing
- Use conventional commits
{% endif %}

{# Use environment variables #}
Project owner: {{ GIT_AUTHOR_NAME | default("unknown") }}
```

**Custom filter:** `regex_test(pattern)` — tests a string against a regex. Supports `~/` expansion.

**Command:** `/debug-prompt` — opens the fully rendered system prompt in `$VISUAL`/`$EDITOR` for inspection.

**Flag:** `--debug-prompt` — prints the system prompt and exits (useful for CI/scripting).

---

## Session Utilities

### `tldr`

> Generate a catch-up summary of the current session.

Use `/tldr` when returning to a session and needing a quick recap. It reads the conversation, strips tool calls and thinking blocks, sends the transcript to a small model, and shows the summary in transient UI. The summary is **not** added to the agent's context.

**Command:** `/tldr`

**Debug flags:**

| Flag                      | Description                             |
| ------------------------- | --------------------------------------- |
| `--debug-tldr`            | Print the generated summary and exit    |
| `--debug-tldr-transcript` | Print the extracted transcript and exit |

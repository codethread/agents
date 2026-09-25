# `system-prompt`

> Prompt extension that owns Pi's effective system prompt and injects rendered rules.

This directory is intentionally flat:

- `index.ts` — prompt composition and Millstrand lifecycle wiring
- `prompt-builder.ts` — pure system-prompt rendering helpers
- `templates.ts` — `agent.njk` discovery/rendering plus `--debug-prompt` override parsing
- `tool-report.ts` — `--debug-tools` selector parsing and report rendering

## Behavior

The extension replaces Pi's generated prompt during `before_agent_start` using structured `systemPromptOptions` for the renderer persona, tool metadata, skills, context files, append text, date, and cwd. It also loads `CLAUDE.local.md` from the cwd and each ancestor, ordered from the filesystem root toward the cwd, and appends those files after Pi's discovered `AGENTS.md`/`CLAUDE.md` context files.

At startup this extension calls the [Harnesses package](https://github.com/codethread/millhouse.spool/tree/main/spools/harnesses)'s native identity resolver. This extension renders its canonical instruction once as `<system-reminder type="millstrand-identity">` and publishes the friendly name with Pi's `ui.setStatus`. The statusline reads that status directly; emote has no identity-specific wiring.

Identity registration, workspace discovery, and child environment scoping belong to Harnesses. This extension owns the optional-identity policy: failed lookup must not prevent using Pi. This repo does not fetch, render, or acknowledge managed-guidance bundles. Task and policy appends use Pi's ordinary prompt options.

It also renders Nunjucks rule templates into the owned prompt:

1. global template: `<PI_CODING_AGENT_DIR>/agent.njk`
2. nearest project template: `.pi/agent.njk` walking upward from cwd

Templates are discovered, read, and rendered once at session startup, alongside Pi's other prompt resources. Templates and identity lookup run together through `Promise.all`. Template failures still surface; identity failures are retained only for debug inspection. `/reload` starts the lifecycle again, so template edits take effect after a reload or a new session rather than on the next turn. Identity resolution also replays on reload; Millhouse recovers the same binding instead of relying on an injection sentinel.

If both exist, both are rendered as separate XML blocks: global inside `<system-reminder type="rules">`, project inside `<system-reminder type="project-rules">`.

The owned prompt also includes a stable `<system-reminder type="project-rules">` instruction explaining that project-rule reminders may be injected automatically when matching files are mentioned or read. Agents are told to apply those reminders silently, not acknowledge or summarize them, and continue the assigned task.

## Template variables

Templates receive:

- `provider`, `model`, `cwd`, `hasUI`
- `isMainAgent` / `isSubagent`, derived from `PI_SUBAGENT=1`
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

## Identity lifecycle

- Harnesses discovers the canonical Git project's `.millstrand` workspace, including linked worktrees. Outside a Millstrand project, it does nothing.
- Each startup, resume, reload, or fork resolves the actual native session through `strand agent native-startup`. Same-session resolution recovers the identity; a new session gets its own. Managed roots supply only `MILLSTRAND_RUN_ID` for run correlation.
- Identity is optional. A missing or invalid workspace, unavailable Weaver, or failed registration leaves Pi usable without an identity block or status name. Normal startup emits no identity error or warning. Diagnostics remain available through `/debug-millstrand-identity` and its CLI flag. The resolver has a bounded subprocess timeout and does not retry or start infrastructure.
- Delegated children receive only parent attribution, not the parent's run or workspace. See [subagent identity](../tools/subagent/README.md#native-child-identity).
- Startup and shutdown clear the UI status, so a previous session's name cannot remain displayed.

Identity resolution needs a running Weaver exposing `agent native-startup`; check with `strand help agent native-startup`. If it is unavailable, Pi continues without identity. Installing the dependency does not update a running Weaver. The former identity/workspace override flags and managed-guidance debug flag are removed.

## Debug surfaces

- `--debug-prompt` — print the next materialized effective system prompt and exit; send a message manually (for example with `--print ping`); accepts optional JSON template-var overrides
- `/debug-prompt` — show the last materialized effective system prompt in the UI; if no message has been sent yet, it warns the user to send one first
- `--debug-tools [tool,...]` — print all registered tools, or selected tools, with active status, their approximate system-prompt contribution, and provider-neutral model definition; exits before a model request
- `--debug-millstrand-identity` — print the optional native binding/status and any lookup diagnostic as JSON, then exit before a model request
- `/debug-millstrand-identity` — show the current binding/status in the standard hidden debug panel

Example:

```bash
pi --debug-prompt --print ping '{"model":"claude-sonnet"}'
pi --debug-tools bash,ls
```

Related messaging behavior:

- [`../messaging/project-structure/README.md`](../messaging/project-structure/README.md)
- [`../messaging/project-rules/README.md`](../messaging/project-rules/README.md)

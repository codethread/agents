# `system-prompt`

> Prompt extension that owns Pi's effective system prompt and injects rendered rules.

This directory is intentionally flat:

- `index.ts` — Pi flags, commands, event hooks, and tool-guideline grouping
- `native-identity.ts` — unmanaged Strand identity invocation, response parsing, and lifecycle status
- `managed-guidance.ts` — disabled native-v1 metadata, bundle, rendering, receipt, and bounded transport boundary
- `prompt-builder.ts` — pure system-prompt rendering helpers
- `templates.ts` — `agent.njk` discovery/rendering plus `--debug-prompt` override parsing
- `tool-report.ts` — `--debug-tools` selector parsing and report rendering

## Behavior

The extension replaces Pi's generated prompt during `before_agent_start` using structured `systemPromptOptions` for the renderer persona, tool metadata, skills, context files, append text, date, and cwd. It also loads `CLAUDE.local.md` from the cwd and each ancestor, ordered from the filesystem root toward the cwd, and appends those files after Pi's discovered `AGENTS.md`/`CLAUDE.md` context files.

On every `session_start`, the extension passes Pi's actual `ctx.sessionManager.getSessionId()` and `ctx.cwd` to `strand identity startup pi`. This covers startup, reload, resume, new-session, and fork lifecycles: the same native ID recovers its identity, while a new/forked ID gets its own binding. The canonical instruction returned by Millhouse is rendered once as `<system-reminder type="millstrand-identity">` in the owned prompt on every turn. It is separate from both the renderer persona and user append text.

The resolved session context is published over Pi's shared `pi.events` bus for other extensions. This is deliberately not module state: Pi loads each extension through an isolated jiti instance with `moduleCache: false`. Each lifecycle first publishes an unbound reset, then the newly resolved identity and explicit workspace; shutdown publishes another reset.

The native contract requires Millhouse identity implementation `9939588e925c5a3c73608feb8182c4f52d586f64` (the implementation released by Millhouse merge `b1955a96ad91bf2909a407859fca1565ec4b9fdb`) or newer. The supported host package is `@earendil-works/pi-coding-agent` 0.84.4.

It also renders Nunjucks rule templates into the owned prompt:

1. global template: `<PI_CODING_AGENT_DIR>/agent.njk`
2. nearest project template: `.pi/agent.njk` walking upward from cwd

Templates are discovered, read, and rendered once at session startup, alongside Pi's other prompt resources. Rendering runs concurrently with identity startup, but template rejection is handled immediately and surfaced through the session lifecycle rather than escaping as an unhandled process rejection. `/reload` starts the lifecycle again, so template edits take effect after a reload or a new session rather than on the next turn. Identity resolution also replays on reload; Millhouse recovers the same binding instead of relying on an injection sentinel.

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

## Identity routing and failure

- Normal unmanaged startup needs no Millstrand identity, run, or reservation environment variables. Strand discovers a workspace from `--cwd`.
- `--millstrand-workspace <dir>` selects an explicit workspace. A relative value is resolved once against the parent session cwd, then the resulting absolute route is used for parent startup and passed unchanged to child and grandchild sessions through private child metadata. It is not reinterpreted against a delegated child's cwd or inherited as managed ownership.
- `--millstrand-identity <name>` asserts an existing identity already bound to this exact Pi session. It cannot invent, attach, or move a friendly name; Millhouse rejects unknown or conflicting values before writing.
- A process with `MILLSTRAND_RUN_ID` but no `MILLSTRAND_MANAGED_GUIDANCE` document is treated as a legacy managed launch. Native resolution is suppressed, so its existing append-system-prompt transport remains authoritative.
- The exact closed legacy guidance document also suppresses native identity. Unknown, malformed, duplicate-key, partial, or oversized guidance never falls through to unmanaged identity.
- Explicit `native-v1` requires the matching managed bootstrap, run/attempt/invocation/provider/native-session/capability/bundle fences, and a strict bundle from the versioned `agent startup` attachment operation. Identity is rendered first, every frozen append position is preserved in order, and one deterministic current-run footer closes one managed reminder block.
- Every startup/resume/reload lifecycle fetches again; every effective prompt reconstructs the managed block and performs a fenced adapter-handoff acknowledgement immediately before return. There is no permanent sentinel. Startup, validation, rendering, and handoff errors submit a fenced failure receipt and mark the lifecycle blocked. Because Pi reports extension-handler exceptions and continues its runner, the owned extension also handles later input and aborts an already-entered provider boundary so the selected turn cannot contact a model. It does not mint identity, retry, fall back to legacy, truncate, or add a second prompt owner.
- `MILLSTRAND_MANAGED_BOOTSTRAP`, `MILLSTRAND_MANAGED_GUIDANCE`, and existing ownership/bootstrap hints are removed from delegated child environments. `PI_SUBAGENT=1` cannot consume root guidance ownership.
- Strand, workspace, Weaver, conflict, and response-schema failures are reported visibly. Unmanaged Pi remains usable but unbound, and no identity block is rendered. The extension never guesses a name, retries, creates a workspace, or starts infrastructure.

## Debug surfaces

- `--debug-prompt` — print the next materialized effective system prompt and exit; send a message manually (for example with `--print ping`); accepts optional JSON template-var overrides
- `/debug-prompt` — show the last materialized effective system prompt in the UI; if no message has been sent yet, it warns the user to send one first
- `--debug-tools [tool,...]` — print all registered tools, or selected tools, with active status, their approximate system-prompt contribution, and provider-neutral model definition; exits before a model request
- `--debug-millstrand-identity` — resolve and print the unmanaged native session binding/status as JSON, then exit before a model request
- `/debug-millstrand-identity` — show the current unmanaged binding/status in the standard hidden debug panel
- `--debug-managed-guidance` — on an already fenced native-v1 fixture, fetch, render, acknowledge, print the evidence and effective prompt, then exit before a model request

Example:

```bash
pi --debug-prompt --print ping '{"model":"claude-sonnet"}'
pi --debug-tools bash,ls
```

Related messaging behavior:

- [`../messaging/project-structure/README.md`](../messaging/project-structure/README.md)
- [`../messaging/project-rules/README.md`](../messaging/project-rules/README.md)

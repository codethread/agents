# Project Rules Autoload Specification

**Status:** Implemented  
**Last Updated:** 2026-05-23

## 1. Overview

### Purpose

Define project-local rule loading for Pi so repositories can provide Claude-compatible `.claude/rules/` files and Pi-native `.agents/rules/` files. Rules without path frontmatter become stable system-prompt instructions. Path-scoped rules are surfaced only when relevant files are mentioned by the user or read by the agent, with visible UI feedback similar to the project-structure message.

### Goals

- Support project-local `.claude/rules/**/*.md` and `.agents/rules/**/*.md` discovery.
- Preserve Claude-style unconditional vs path-scoped rule behavior.
- Let `.agents/rules` override `.claude/rules` for the same relative rule path.
- Put unconditional rules in the effective system prompt.
- Send path-scoped rules as model-visible follow-up context when triggered by user file mentions or successful `read` results.
- Render a visible TUI notice when path-scoped rules are sent.
- Keep implementation shared enough that `system-prompt` and `messaging` use the same discovery, parsing, matching, and override semantics.

### Non-Goals

- No user/global rule discovery: do not load `~/.claude/rules` or `~/.agents/rules`.
- No managed-policy rules, organization rules, or `claudeMdExcludes` support.
- No exact Claude `/memory` implementation.
- No dynamic system-prompt mutation after startup for path-scoped rules.
- No `@path` imports inside rule files for this feature.
- No attempt to make rule instructions enforceable configuration; rules are prompt context.

## 2. Design Decisions

- **Decision:** Project rules are discovered only under the repository/project root.
  - **Rationale:** The user explicitly wants `<project>/.agents/rules`, not user-level `~/.agents/rules`. Using the same root resolution as project-structure avoids accidentally loading personal or parent-directory rules.

- **Decision:** `.agents/rules` overrides `.claude/rules` only when the relative nested path is identical.
  - **Rationale:** This preserves compatibility with Claude rule packs while allowing Pi-native replacements without duplicate instructions. Exact nesting avoids surprising overrides between unrelated files with the same basename.

- **Decision:** Unconditional rules are rendered into the system prompt.
  - **Rationale:** Rules without `paths` are stable operating instructions that should be present for every turn, matching Claude's documented behavior and the existing `system-prompt` boundary for durable instructions.

- **Decision:** Path-scoped rules are sent as custom messages, not appended to the system prompt.
  - **Rationale:** They are volatile context triggered by the active files. Custom messages can be displayed in the UI like project-structure and can refresh as work shifts without rebuilding the system prompt.

- **Decision:** Read-triggered rules are sent as custom messages to start, not appended directly to read tool results.
  - **Rationale:** The closest Pi analogue to Claude's “trigger when Claude reads files matching the pattern” is the read tool result lifecycle, but custom messages satisfy the explicit UI requirement and match the project-structure extension pattern. Tool-result augmentation can be reconsidered later if adjacency proves more important.

- **Decision:** User-prompt file triggers are detected during `before_agent_start`.
  - **Rationale:** Pi exposes the expanded prompt before the agent loop. This catches CLI `@file` content rendered as `<file name="...">` and literal user mentions such as `@src/foo.ts` before the model starts planning.

- **Decision:** Malformed frontmatter is non-blocking and reported as a UI warning.
  - **Rationale:** A bad project rule should not prevent the user from continuing work, but silent rule drops make prompt behavior hard to debug. Warning with the file path and reason preserves visibility.

- **Decision:** Rule files hot-reload across turns.
  - **Rationale:** Users expect changes under `.claude/rules` and `.agents/rules` to affect future turns without restarting Pi. Changed path-scoped rules should invalidate send caches; newly added matching rules should become eligible immediately. Newly added or changed unconditional rules are sent on the next turn as custom message context rather than mutating an already-materialized system prompt mid-session.

## 3. Architecture

### Component structure

```text
pi-extensions/
├── shared/
│   └── project-rules.ts          # New shared discovery, parsing, matching, rendering helpers
├── system-prompt/
│   ├── index.ts                  # Adds unconditional project rules to prompt input
│   └── prompt-builder.ts         # Renders unconditional project rules in system prompt
└── messaging/
    └── project-rules/            # New extension for path-scoped rule messages
        ├── index.ts              # Hooks before_agent_start and tool_result
        └── README.md             # Usage and behavior notes
```

The exact file names can change during implementation, but discovery and matching must be shared rather than duplicated between `system-prompt` and `messaging`.

### Data flow

```text
ctx.cwd
  │
  ├─ resolve project root
  │
  ├─ discover .claude/rules/**/*.md
  ├─ discover .agents/rules/**/*.md
  │
  ├─ apply relative-path override
  │     .agents/rules/<same/nested/file.md>
  │     replaces .claude/rules/<same/nested/file.md>
  │
  ├─ parse frontmatter
  │     paths missing -> unconditional
  │     paths present -> path-scoped
  │
  ├─ system-prompt before_agent_start
  │     unconditional rules -> effective system prompt
  │
  └─ messaging triggers
        before_agent_start prompt file mentions -> matching scoped rules -> custom message
        successful read tool_result             -> matching scoped rules -> custom message
```

## 4. Rule Semantics

### Discovery roots

For a project root `P`, discover Markdown rule files recursively in:

1. `P/.claude/rules/**/*.md`
2. `P/.agents/rules/**/*.md`

No other roots are scanned.

### Override identity

The override key is the path relative to the rules directory. Examples:

| Claude file                       | Agents file                       | Result              |
| --------------------------------- | --------------------------------- | ------------------- |
| `.claude/rules/testing.md`        | `.agents/rules/testing.md`        | agents version only |
| `.claude/rules/frontend/react.md` | `.agents/rules/frontend/react.md` | agents version only |
| `.claude/rules/frontend/react.md` | `.agents/rules/react.md`          | both load           |

After overrides, rules are ordered deterministically by relative rule path. If two rules have different source roots but no override, `.claude` rules appear before `.agents` rules for the same lexical neighborhood unless implementation chooses a simpler full lexical order; tests must lock the chosen order.

### Frontmatter

Rule files may start with YAML frontmatter. The only required feature is `paths`:

```md
---
paths:
  - "src/api/**/*.ts"
  - "tests/**/*.test.ts"
---

# API Rules

- Validate inputs.
```

- Missing frontmatter means unconditional.
- Frontmatter without `paths` means unconditional.
- `paths` must be an array of non-empty strings.
- Empty `paths` is treated as unconditional only if explicitly accepted by tests; otherwise fail loudly. Prefer failing loudly.
- Malformed YAML or invalid `paths` produces a visible UI warning and excludes that rule from prompt injection for that turn. It must not block the turn.

### Glob matching

- Path patterns are matched against project-relative POSIX-style paths.
- Absolute read paths are normalized to project-relative paths before matching.
- Relative read paths are resolved against `ctx.cwd`, then normalized to project-relative paths.
- Patterns should support common glob syntax, including `**` and brace expansion such as `src/**/*.{ts,tsx}` if the chosen matcher supports it.
- Files outside the project root do not trigger project rules.

## 5. Interfaces and Hooks

### System prompt integration

`pi-extensions/system-prompt/` adds a section for unconditional project rules. The rendered form should include source paths for debuggability:

```xml
<system-reminder type="project-rules">
<rule-file path="/repo/.agents/rules/testing.md">
...
</rule-file>
</system-reminder>
```

This section appears with other operating rules, before project context files and skills.

### Path-scoped messaging integration

A new messaging extension sends model-visible custom messages for triggered path-scoped rules. The TUI renderer should show a concise visible row, for example:

```text
Project rules sent to agent
```

The message content should identify why the rules were sent:

```xml
<system-reminder type="project-rules">
Triggered by files:
- src/api/users.ts

<rule-file path="/repo/.agents/rules/api.md">
...
</rule-file>
</system-reminder>
```

### User prompt triggers

During `before_agent_start`, inspect `event.prompt` for file references:

- `<file name="/abs/path">` blocks produced by CLI `@file` expansion.
- Literal `@path` mentions when they look like project file paths.

When mentioned paths match scoped rules, send one custom message containing all newly-triggered matching rules.

### Read tool triggers

During `tool_result` for successful `read` calls:

- Resolve `event.input.path` to a project-relative path.
- Match scoped rules.
- Send matching rules as a custom message.
- Show the custom message renderer in the UI when rules are sent.

The implementation must avoid repeatedly sending the same rule for the same triggering project path in a session unless the rule file changes, a new overriding rule appears, or the session resets.

### Hot reload and invalidation

Rules are rediscovered on each turn and when relevant rule files are observed to change. Implementation may use filesystem watchers or cheap per-turn stat/discovery; behavior matters more than mechanism.

- A changed rule file invalidates cached sends for that rule.
- A newly added path-scoped rule is eligible for matching from the next trigger.
- A newly added unconditional rule is sent on the next turn as custom message context.
- A changed unconditional rule is sent on the next turn as custom message context.
- Deleted rules stop being sent; previously sent conversation context is not retracted.
- If `.agents/rules/<relative>.md` is added and overrides an already-sent `.claude/rules/<relative>.md`, the agents rule is treated as a new/changed rule and is eligible to be sent.

## 6. Debug and UX

- `/debug-prompt` and `--debug-prompt` should include unconditional rules because they are part of the system prompt.
- Path-scoped rules should not appear in `/debug-prompt` unless they have been sent as conversation messages; provide separate tests/README examples instead.
- Unconditional rules discovered after the initial system prompt was materialized should be visible as project-rule custom messages, not retroactively inserted into `/debug-prompt` for an existing turn.
- The custom message renderer should be visible like project-structure, not hidden.
- If rule discovery or parsing fails, notify the user with the rule path and reason.

## 7. Testing

Automated tests cover shared discovery, override, parsing, matching, path normalization, and malformed-frontmatter warning behavior in `pi-extensions/shared/project-rules.test.ts`.

Broader behavior to preserve:

- Discovers `.claude/rules/**/*.md` under project root.
- Discovers `.agents/rules/**/*.md` under project root.
- Does not discover `~/.claude/rules` or `~/.agents/rules`.
- Recursive discovery works.
- `.agents/rules/<relative>` overrides `.claude/rules/<relative>`.
- Different relative paths do not override, even with the same basename.
- Frontmatter `paths` parsing and validation.
- Unconditional rules render into the system prompt.
- Path-scoped rules do not render into the system prompt by default.
- User prompt file mentions trigger matching path-scoped rules.
- Successful `read` results trigger matching path-scoped rules.
- Non-matching files do not trigger scoped rules.
- Duplicate rule/path sends are suppressed within a session.
- Project-structure and project-rules custom messages can coexist.

## 8. Code Locations

- `pi-extensions/shared/project-rules.ts` — shared discovery/parsing/matching/rendering module.
- `pi-extensions/shared/project-rules.test.ts` — shared behavior coverage.
- `pi-extensions/system-prompt/index.ts` — discovers unconditional project rules and passes them into prompt building.
- `pi-extensions/system-prompt/prompt-builder.ts` — renders unconditional project rules in the owned system prompt.
- `pi-extensions/messaging/project-rules/index.ts` — path-scoped autoload messaging extension.
- `pi-extensions/messaging/project-rules/README.md` — rule behavior and examples.
- `pi-extensions/README.md` — extension index entry.
- `specs/README.md` — spec index entry.

## 9. Open Questions

- Should rule hot-reload use filesystem watchers, per-turn rediscovery, or a hybrid? Prefer the simplest reliable implementation that keeps next-turn behavior correct.
- Should custom rule messages show the triggering file path(s) in the visible UI row, or only in expanded/details content?

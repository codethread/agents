# Project Rules Autoload Specification

**Document ID:** `SPEC-001`

**Status:** Implemented  
**Last Updated:** 2026-05-23
**Configuration identification:** `SPEC-001` prefixes section and point identifiers in this document. Existing human-readable numbering is preserved for migration traceability.

## SPEC-001.P1 1. Overview

### SPEC-001.P2 Purpose

Define project-local rule loading for Pi so repositories can provide Claude-compatible `.claude/rules/` files and Pi-native `.agents/rules/` files. Rules without path frontmatter become stable system-prompt instructions. Path-scoped rules are surfaced only when relevant files are mentioned by the user or read by the agent, with visible UI feedback similar to the project-structure message.

### SPEC-001.P3 Goals

- **SPEC-001.B1:** Support project-local `.claude/rules/**/*.md` and `.agents/rules/**/*.md` discovery.
- **SPEC-001.B2:** Preserve Claude-style unconditional vs path-scoped rule behavior.
- **SPEC-001.B3:** Let `.agents/rules` override `.claude/rules` for the same relative rule path.
- **SPEC-001.B4:** Put unconditional rules in the effective system prompt.
- **SPEC-001.B5:** Send path-scoped rules as model-visible follow-up context when triggered by user file mentions or successful `read` results.
- **SPEC-001.B6:** Render a visible TUI notice when path-scoped rules are sent.
- **SPEC-001.B7:** Keep implementation shared enough that `system-prompt` and `messaging` use the same discovery, parsing, matching, and override semantics.

### SPEC-001.P4 Non-Goals

- **SPEC-001.B8:** No user/global rule discovery: do not load `~/.claude/rules` or `~/.agents/rules`.
- **SPEC-001.B9:** No managed-policy rules, organization rules, or `claudeMdExcludes` support.
- **SPEC-001.B10:** No exact Claude `/memory` implementation.
- **SPEC-001.B11:** No dynamic system-prompt mutation after startup for path-scoped rules.
- **SPEC-001.B12:** No `@path` imports inside rule files for this feature.
- **SPEC-001.B13:** No attempt to make rule instructions enforceable configuration; rules are prompt context.

## SPEC-001.P5 2. Design Decisions

- **SPEC-001.D1 Decision:** Project rules are discovered only under the repository/project root.
  - **Rationale:** The user explicitly wants `<project>/.agents/rules`, not user-level `~/.agents/rules`. Using the same root resolution as project-structure avoids accidentally loading personal or parent-directory rules.

- **SPEC-001.D2 Decision:** `.agents/rules` overrides `.claude/rules` only when the relative nested path is identical.
  - **Rationale:** This preserves compatibility with Claude rule packs while allowing Pi-native replacements without duplicate instructions. Exact nesting avoids surprising overrides between unrelated files with the same basename.

- **SPEC-001.D3 Decision:** Unconditional rules are rendered into the system prompt.
  - **Rationale:** Rules without `paths` are stable operating instructions that should be present for every turn, matching Claude's documented behavior and the existing `system-prompt` boundary for durable instructions.

- **SPEC-001.D4 Decision:** Path-scoped rules are sent as custom messages, not appended to the system prompt.
  - **Rationale:** They are volatile context triggered by the active files. Custom messages can be displayed in the UI like project-structure and can refresh as work shifts without rebuilding the system prompt.

- **SPEC-001.D5 Decision:** Read-triggered rules are sent as custom messages to start, not appended directly to read tool results.
  - **Rationale:** The closest Pi analogue to Claude's “trigger when Claude reads files matching the pattern” is the read tool result lifecycle, but custom messages satisfy the explicit UI requirement and match the project-structure extension pattern. Tool-result augmentation can be reconsidered later if adjacency proves more important.

- **SPEC-001.D6 Decision:** User-prompt file triggers are detected during `before_agent_start`.
  - **Rationale:** Pi exposes the expanded prompt before the agent loop. This catches CLI `@file` content rendered as `<file name="...">` and literal user mentions such as `@src/foo.ts` before the model starts planning.

- **SPEC-001.D7 Decision:** Malformed frontmatter is non-blocking and reported as a UI warning.
  - **Rationale:** A bad project rule should not prevent the user from continuing work, but silent rule drops make prompt behavior hard to debug. Warning with the file path and reason preserves visibility.

- **SPEC-001.D8 Decision:** Rule files hot-reload across turns.
  - **Rationale:** Users expect changes under `.claude/rules` and `.agents/rules` to affect future turns without restarting Pi. Changed path-scoped rules should invalidate send caches; newly added matching rules should become eligible immediately. Newly added or changed unconditional rules are sent on the next turn as custom message context rather than mutating an already-materialized system prompt mid-session.

## SPEC-001.P6 3. Architecture

### SPEC-001.P7 Component structure

```text
pi/extensions/
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

### SPEC-001.P8 Data flow

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

## SPEC-001.P9 4. Rule Semantics

### SPEC-001.P10 Discovery roots

For a project root `P`, discover Markdown rule files recursively in:

1. `P/.claude/rules/**/*.md`
2. `P/.agents/rules/**/*.md`

No other roots are scanned.

### SPEC-001.P11 Override identity

The override key is the path relative to the rules directory. Examples:

| Claude file                       | Agents file                       | Result              |
| --------------------------------- | --------------------------------- | ------------------- |
| `.claude/rules/testing.md`        | `.agents/rules/testing.md`        | agents version only |
| `.claude/rules/frontend/react.md` | `.agents/rules/frontend/react.md` | agents version only |
| `.claude/rules/frontend/react.md` | `.agents/rules/react.md`          | both load           |

After overrides, rules are ordered deterministically by relative rule path. If two rules have different source roots but no override, `.claude` rules appear before `.agents` rules for the same lexical neighborhood unless implementation chooses a simpler full lexical order; tests must lock the chosen order.

### SPEC-001.P12 Frontmatter

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

- **SPEC-001.B14:** Missing frontmatter means unconditional.
- **SPEC-001.B15:** Frontmatter without `paths` means unconditional.
- **SPEC-001.B53:** `paths` must be an array of non-empty strings.
- **SPEC-001.B16:** Empty `paths` is treated as unconditional only if explicitly accepted by tests; otherwise fail loudly. Prefer failing loudly.
- **SPEC-001.B17:** Malformed YAML or invalid `paths` produces a visible UI warning and excludes that rule from prompt injection for that turn. It must not block the turn.

### SPEC-001.P13 Glob matching

- **SPEC-001.B18:** Path patterns are matched against project-relative POSIX-style paths.
- **SPEC-001.B19:** Absolute read paths are normalized to project-relative paths before matching.
- **SPEC-001.B20:** Relative read paths are resolved against `ctx.cwd`, then normalized to project-relative paths.
- **SPEC-001.B21:** Patterns should support common glob syntax, including `**` and brace expansion such as `src/**/*.{ts,tsx}` if the chosen matcher supports it.
- **SPEC-001.B22:** Files outside the project root do not trigger project rules.

## SPEC-001.P14 5. Interfaces and Hooks

### SPEC-001.P15 System prompt integration

`pi/extensions/system-prompt/` adds a section for unconditional project rules. The rendered form should include source paths for debuggability:

```xml
<system-reminder type="project-rules">
<rule-file path="/repo/.agents/rules/testing.md">
...
</rule-file>
</system-reminder>
```

This section appears with other operating rules, before project context files and skills.

### SPEC-001.P16 Path-scoped messaging integration

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

### SPEC-001.P17 User prompt triggers

During `before_agent_start`, inspect `event.prompt` for file references:

- **SPEC-001.B54:** `<file name="/abs/path">` blocks produced by CLI `@file` expansion.
- **SPEC-001.B23:** Literal `@path` mentions when they look like project file paths.

When mentioned paths match scoped rules, send one custom message containing all newly-triggered matching rules.

### SPEC-001.P18 Read tool triggers

During `tool_result` for successful `read` calls:

- **SPEC-001.B24:** Resolve `event.input.path` to a project-relative path.
- **SPEC-001.B25:** Match scoped rules.
- **SPEC-001.B26:** Send matching rules as a custom message.
- **SPEC-001.B27:** Show the custom message renderer in the UI when rules are sent.

The implementation must avoid repeatedly sending the same rule for the same triggering project path in a session unless the rule file changes, a new overriding rule appears, or the session resets.

### SPEC-001.P19 Hot reload and invalidation

Rules are rediscovered on each turn and when relevant rule files are observed to change. Implementation may use filesystem watchers or cheap per-turn stat/discovery; behavior matters more than mechanism.

- **SPEC-001.B28:** A changed rule file invalidates cached sends for that rule.
- **SPEC-001.B29:** A newly added path-scoped rule is eligible for matching from the next trigger.
- **SPEC-001.B30:** A newly added unconditional rule is sent on the next turn as custom message context.
- **SPEC-001.B31:** A changed unconditional rule is sent on the next turn as custom message context.
- **SPEC-001.B32:** Deleted rules stop being sent; previously sent conversation context is not retracted.
- **SPEC-001.B33:** If `.agents/rules/<relative>.md` is added and overrides an already-sent `.claude/rules/<relative>.md`, the agents rule is treated as a new/changed rule and is eligible to be sent.

## SPEC-001.P20 6. Debug and UX

- **SPEC-001.B55:** `/debug-prompt` and `--debug-prompt` should include unconditional rules because they are part of the system prompt.
- **SPEC-001.B34:** Path-scoped rules should not appear in `/debug-prompt` unless they have been sent as conversation messages; provide separate tests/README examples instead.
- **SPEC-001.B35:** Unconditional rules discovered after the initial system prompt was materialized should be visible as project-rule custom messages, not retroactively inserted into `/debug-prompt` for an existing turn.
- **SPEC-001.B36:** The custom message renderer should be visible like project-structure, not hidden.
- **SPEC-001.B37:** If rule discovery or parsing fails, notify the user with the rule path and reason.

## SPEC-001.P21 7. Testing

Automated tests cover shared discovery, override, parsing, matching, path normalization, and malformed-frontmatter warning behavior in `pi/extensions/shared/project-rules.test.ts`.

Broader behavior to preserve:

- **SPEC-001.B38:** Discovers `.claude/rules/**/*.md` under project root.
- **SPEC-001.B39:** Discovers `.agents/rules/**/*.md` under project root.
- **SPEC-001.B40:** Does not discover `~/.claude/rules` or `~/.agents/rules`.
- **SPEC-001.B41:** Recursive discovery works.
- **SPEC-001.B56:** `.agents/rules/<relative>` overrides `.claude/rules/<relative>`.
- **SPEC-001.B42:** Different relative paths do not override, even with the same basename.
- **SPEC-001.B43:** Frontmatter `paths` parsing and validation.
- **SPEC-001.B44:** Unconditional rules render into the system prompt.
- **SPEC-001.B45:** Path-scoped rules do not render into the system prompt by default.
- **SPEC-001.B46:** User prompt file mentions trigger matching path-scoped rules.
- **SPEC-001.B47:** Successful `read` results trigger matching path-scoped rules.
- **SPEC-001.B48:** Non-matching files do not trigger scoped rules.
- **SPEC-001.B49:** Duplicate rule/path sends are suppressed within a session.
- **SPEC-001.B50:** Project-structure and project-rules custom messages can coexist.

## SPEC-001.P22 8. Code Locations

- **SPEC-001.B57:** `pi/extensions/shared/project-rules.ts` — shared discovery/parsing/matching/rendering module.
- **SPEC-001.B58:** `pi/extensions/shared/project-rules.test.ts` — shared behavior coverage.
- **SPEC-001.B59:** `pi/extensions/system-prompt/index.ts` — discovers unconditional project rules and passes them into prompt building.
- **SPEC-001.B60:** `pi/extensions/system-prompt/prompt-builder.ts` — renders unconditional project rules in the owned system prompt.
- **SPEC-001.B61:** `pi/extensions/messaging/project-rules/index.ts` — path-scoped autoload messaging extension.
- **SPEC-001.B62:** `pi/extensions/messaging/project-rules/README.md` — rule behavior and examples.
- **SPEC-001.B63:** `pi/extensions/README.md` — extension index entry.
- **SPEC-001.B64:** `devflow/README.md` — devflow spec index entry.

## SPEC-001.P23 9. Open Questions

- **SPEC-001.B51:** Should rule hot-reload use filesystem watchers, per-turn rediscovery, or a hybrid? Prefer the simplest reliable implementation that keeps next-turn behavior correct.
- **SPEC-001.B52:** Should custom rule messages show the triggering file path(s) in the visible UI row, or only in expanded/details content?

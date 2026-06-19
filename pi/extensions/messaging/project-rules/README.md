# project-rules

Loads project-local rule files from:

- `.claude/rules/**/*.md`
- `.agents/rules/**/*.md`

`.agents/rules/<same/nested/file.md>` overrides `.claude/rules/<same/nested/file.md>`.

Rules without `paths` frontmatter are added to the system prompt by the system-prompt extension. Rules with `paths` frontmatter are sent as visible custom messages when matching files are mentioned in the user prompt or read with the `read` tool.

Read-triggered rules use Pi's `steer` delivery mode so they are applied before the next LLM call instead of being queued as end-of-task follow-ups. The owned system prompt also tells agents to apply `<system-reminder type="project-rules">` guidance silently and continue the assigned task without acknowledging the injected reminder.

```md
---
paths:
  - "src/**/*.{ts,tsx}"
---

# TypeScript rules

- Keep changes type-safe.
```

Only project rules are loaded; user-level `~/.claude/rules` and `~/.agents/rules` are ignored.

Malformed frontmatter is reported as a non-blocking UI warning and the malformed rule is skipped for that turn.

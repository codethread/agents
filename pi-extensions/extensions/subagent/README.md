# `subagent`

> Delegate tasks to specialized subagents with isolated context.

The agent is aware of this tool and will use it when asked to delegate work or run tasks in parallel. It also injects the currently discovered subagents into the system prompt as an XML list of names and descriptions so the parent agent can choose among them. You can guide it by describing the kind of work you want delegated.

**How to use it:**

- _"Use the scout agent to map out the folder structure"_
- _"Run these three tasks in parallel: lint, typecheck, and test"_
- _"Project-local agents in .pi/agents are discovered automatically too"_

The agent can invoke subagents in two modes:

| Mode         | When to use                                     | What happens                |
| ------------ | ----------------------------------------------- | --------------------------- |
| **Single**   | One focused task                                | Spawns one agent process    |
| **Parallel** | Independent tasks that can run at the same time | Up to 8 tasks, 4 concurrent |

Tool calls require a terse `description` field for delegated work (single mode `description`, parallel mode `tasks[].description`).

## Session logs

When the parent Pi session is persisted, each subagent run is also persisted with `--session` and indexed in a manifest.

Storage path:

```text
~/.pi/agent/subagent-sessions/
  --<cwd-encoded>--/
    <parent-session-id>/
      manifest.json
      <uuid>.jsonl
```

- `<cwd-encoded>` matches Pi session directory naming (`/path/to/project` → `--path-to-project--`)
- `manifest.json` contains one entry per subagent run (agent, description, prompt, model/provider, usage, cost, duration, exit code)
- each entry references a session file by filename (`<uuid>.jsonl`)

If the parent session is not persisted, subagents keep `--no-session` behavior and no manifest is written.

**Creating agents:**

Agent files are markdown files with YAML frontmatter, placed in one of:

- `~/.pi/agent/agents/` — user-defined agents
- `.pi/agents/` — project-local agents, discovered from `cwd` upward

Bundled package agents are always included too, and Pi sees one merged list with project definitions overriding user/package names and user definitions overriding package names. In this package, those bundled agents live under `pi-agents/`.

**Agent file format:**

```markdown
---
name: my-agent
description: Short description of what this agent does
meta: Why this agent exists, for authors only
tools: read, bash, edit
model: sonnet
---

You are a specialist in [whatever]. Your job is to...
```

| Frontmatter field | Required | Description                                                          |
| ----------------- | -------- | -------------------------------------------------------------------- |
| `name`            | ✅       | Agent identifier (used in tool calls)                                |
| `description`     | ✅       | Shown to the parent agent for delegation decisions                   |
| `meta`            |          | Author-only note about why the agent exists; ignored by runtime/tool |
| `tools`           |          | Comma-separated list of Pi tool names available to the agent         |
| `model`           |          | Model alias or full `provider/model` identifier                      |

Use canonical Pi tool names in lowercase for new agents. Common built-ins are `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.
Some legacy Claude-style names are normalized, but prefer the Pi names directly in frontmatter.
The optional `meta` field is for maintainers only and is not surfaced to the parent agent via discovery or prompt injection.

The markdown body below the frontmatter becomes the agent's system prompt.

# `subagent`

> Delegate tasks to specialized subagents with isolated context.

The agent is aware of this tool and will use it when asked to delegate work or run tasks in parallel. It also injects the currently discovered subagents into the system prompt as an XML list of names and descriptions so the parent agent can choose among them. You can guide it by describing the kind of work you want delegated.

**How to use it:**

- _"Use the explorer agent to map out the folder structure"_
- _"Run these three tasks in parallel: lint, typecheck, and test"_
- _"Project-local agents in .pi/agents are discovered automatically too"_

The agent can invoke subagents in two modes:

| Mode         | When to use                                     | What happens                |
| ------------ | ----------------------------------------------- | --------------------------- |
| **Single**   | One focused task                                | Spawns one agent process    |
| **Parallel** | Independent tasks that can run at the same time | Up to 8 tasks, 4 concurrent |

**Creating agents:**

Agent files are markdown files with YAML frontmatter, placed in one of:

- `~/.pi/agent/agents/` — user-defined agents
- `.pi/agents/` — project-local agents, discovered from `cwd` upward

Bundled package agents are always included too, and Pi sees one merged list with project definitions overriding user/package names and user definitions overriding package names.

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

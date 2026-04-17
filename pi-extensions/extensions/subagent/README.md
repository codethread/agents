# `subagent`

> Delegate tasks to specialized subagents with isolated context.

The agent is aware of this tool and will use it when asked to delegate work or run tasks in parallel. It also injects the currently discovered subagents into the system prompt as an XML list of names and descriptions so the parent agent can choose among them. Child subagent processes are marked with `PI_SUBAGENT=1`, which lets extensions hide or reshape behavior for delegated runs. You can guide it by describing the kind of work you want delegated.

This extension also registers `--agent <name>` for direct agent mode. That flag resolves the named discovered agent and inherits that agent file's runtime config into the top-level Pi session, so `pi --agent scout` talks to the scout instructions directly without going through the `subagent` tool. Today that inherited config includes the agent prompt body, model/thinking, and the exact tool allowlist.

**How to use it:**

- _"Use the scout agent to map out the folder structure"_
- _"Run these three tasks in parallel: lint, typecheck, and test"_
- _"Project-local agents in .pi/agents are discovered automatically too"_

The tool always uses a `tasks` array. Use one task for focused work, or multiple independent tasks for parallel fan-out.

## Direct agent mode

Use `pi --agent <name>` when you want the current top-level session to adopt one discovered agent directly.
Discovery and override rules are the same as the `subagent` tool: bundled package agents load first, user agents override package agents, and project agents override both.
The flag inherits all currently supported runtime-facing agent fields from the selected agent file. Today that means:

- prompt body → appended to the default system prompt
- `model` → applied to the top-level session model
- `model` thinking suffix (for example `:low`) → applied to Pi thinking level
- `tools` → applied as the exact active tool set across built-in and extension tools

Explicit CLI flags win over inherited agent fields on a per-field basis. For example:

- `--model` or `--provider` overrides the inherited agent model
- `--thinking` overrides the inherited thinking level
- `--tools` or `--no-tools` overrides the inherited tool selection entirely; the CLI value is treated as the final tool set

A missing agent name is a hard failure, and Pi also hard-fails when an inherited agent model cannot be applied unless you override it explicitly on the CLI.

Examples:

- `pi --agent scout "Map the retry flow"`
- `pi --agent builder --model openai-codex/gpt-5.4 "Implement the planned refactor"`
- `pi --agent scout --tools read,bash,edit "Use scout prompt, but replace the inherited tool set"`

| Shape                 | When to use                                     | What happens                |
| --------------------- | ----------------------------------------------- | --------------------------- |
| **`tasks` (1 item)**  | One focused task                                | Spawns one agent process    |
| **`tasks` (N items)** | Independent tasks that can run at the same time | Up to 8 tasks, 4 concurrent |

Each task must include `agent`, `description`, `task`, and `cwd`.

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

Note: there is no extra confirmation prompt in the tool API for project-local agents; delegation uses the same required `tasks[]` schema for package, user, and project agents.

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

| Frontmatter field | Required | Description                                                                                                       |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `name`            | ✅       | Agent identifier (used in tool calls)                                                                             |
| `description`     | ✅       | Shown to the parent agent for delegation decisions                                                                |
| `meta`            |          | Author-only note about why the agent exists; ignored by runtime/tool                                              |
| `tools`           |          | Comma-separated list of tool names available to the agent; built-ins and extension tools share the same namespace |
| `model`           |          | Model alias or full `provider/model` identifier                                                                   |

Use canonical Pi tool names in lowercase for new agents. Common built-ins are `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.
Extension tools such as `subagent` and `questionnaire` are configured through the same `tools` field and are only available when explicitly listed.
Some legacy Claude-style names are normalized, but prefer the Pi names directly in frontmatter.
If `tools` is omitted or blank, the agent inherits an empty tool set unless the CLI overrides it with `--tools` or `--no-tools`.
The optional `meta` field is for maintainers only and is not surfaced to the parent agent via discovery or prompt injection.

The markdown body below the frontmatter becomes the agent's system prompt.

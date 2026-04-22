# `subagent`

> Delegate tasks to specialized agents with isolated context.

Provides two things: the `subagent` tool for delegating work from within a session, and `--agent <name>` for adopting an agent config directly at startup.

Discovered agents are injected into the system prompt as `<system-reminder type="available-subagents">` so the parent agent can choose among them. Agents marked `hidden: true` are callable by name but omitted from that inventory. Child processes are tagged `PI_SUBAGENT=1` so extensions can reshape behavior in delegated runs.

---

## Agent discovery

Three sources merge in priority order — project wins over user, user wins over package:

| Source  | Location                                  |
| ------- | ----------------------------------------- |
| Package | `pi-agents/` (bundled)                    |
| User    | `~/.pi/agent/agents/`                     |
| Project | `.pi/agents/` (nearest ancestor of `cwd`) |

---

## Agent file format

```markdown
---
name: my-agent
description: Short description shown to the parent agent
meta: Author-only note; ignored by runtime
hidden: true
tools: read, bash, edit
model: sonnet
---

You are a specialist in [whatever]...
```

| Field         | Required | Notes                                                                                          |
| ------------- | :------: | ---------------------------------------------------------------------------------------------- |
| `name`        |    ✅    | Identifier used in tool calls and `--agent`                                                    |
| `description` |    ✅    | Shown to parent agent unless `hidden: true`                                                    |
| `meta`        |          | Author note; not surfaced to runtime or parent                                                 |
| `hidden`      |          | Hides from inventory; agent remains discoverable and callable                                  |
| `tools`       |          | Comma-separated. Omit → empty tool set. Extension tools (`subagent`) must be listed explicitly |
| `model`       |          | Alias (`sonnet`) or qualified `provider/model`. Append `:low` etc. for thinking level          |

Canonical Pi tool names: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. Some legacy Claude names are normalized but prefer Pi names.

---

## `subagent` tool

Spawns a `pi` subprocess per task with an isolated context window. The parent sees only each child's final message, not the full transcript.

```json
{
	"tasks": [{ "agent": "scout", "description": "map auth flow", "task": "...", "cwd": "/path" }]
}
```

| Shape     | Behavior                           |
| --------- | ---------------------------------- |
| 1 task    | Single focused run                 |
| 2–8 tasks | Parallel fan-out, max 4 concurrent |

All four fields (`agent`, `description`, `task`, `cwd`) are required per task. `description` should be 3–8 words.

**Usage hints:**

- _"Use the scout agent to map the folder structure"_
- _"Run lint, typecheck, and test in parallel"_

---

## `--agent <name>` direct mode

Adopts a discovered agent's config into the current top-level session:

- prompt body → appended as `<system-reminder type="selected-agent-prompt">`
- `model` → session model
- `model` thinking suffix (`:low`) → Pi thinking level
- `tools` → active tool set

Explicit CLI flags always win over inherited agent fields:

| CLI flag                | Overrides                |
| ----------------------- | ------------------------ |
| `--model`, `--provider` | inherited model          |
| `--thinking`            | inherited thinking level |
| `--tools`, `--no-tools` | inherited tool set       |

A missing agent name or unresolvable model is a hard failure (pass `--model` to override).

```sh
pi --agent scout "Map the retry flow"
pi --agent fixer --model openai/gpt-5 "Fix typecheck failures"
pi --agent scout --tools read,bash,edit "Override the inherited tool set"
```

---

## Session logs

When the parent session is persisted, each subagent run is saved under:

```
~/.pi/agent/subagent-sessions/
  --<cwd-encoded>--/
    <parent-session-id>/
      manifest.json        # one entry per run: agent, cost, duration, exit code, session filename
      <uuid>.jsonl
```

If the parent runs with `--no-session`, subagents also skip persistence.

---

## Debug

```
/debug-agents
```

Sends discovered agent inventory into the conversation (all sources, project dir path).

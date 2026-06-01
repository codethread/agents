# `subagent`

> Delegate one task to one specialized agent or swarm with isolated context.

Provides two things: the `subagent` tool for delegating work from within a session, and `--agent <name>` for adopting a single-agent config directly at startup.

Discovered agents and swarms are injected into the system prompt as an `<available-subagents>` catalog nested under the `subagent` tool entry, so the parent agent can choose among them where tool guidance is defined. Agents or swarms marked `hidden: true` are callable by name but omitted from that inventory. Discovery is evaluated on demand, so edits to agent markdown or swarm definitions are picked up on the next call. Child processes are tagged `PI_SUBAGENT=1` so extensions can reshape behavior in delegated runs.

Agents are discovered from `agents/` directories, while swarms are discovered from `swarms/` directories; these are separate discovery roots in the same working tree.

---

## Agent discovery

Three sources merge in priority order — project wins over user, user wins over package:

| Source  | Location                                  |
| ------- | ----------------------------------------- |
| Package | `pi/agents/` (bundled agents)             |
| User    | `~/.pi/agent/agents/`                     |
| Project | `.pi/agents/` (nearest ancestor of `cwd`) |
| Swarm   | `.pi/swarms/` (nearest ancestor of `cwd`) |

Swarms are configured in folders that contain a `swarm.json` file. See [Swarm configuration](#swarm-configuration) below.

---

## Agent file format

```markdown
---
name: my-agent
description: Short description shown to the parent agent
meta: Author-only note; ignored by runtime
hidden: true
tools: read, bash, edit
model: openai/gpt-5.4-mini:low
---

You are a specialist in [whatever]...
```

| Field         | Required | Notes                                                                                                                                                                                           |
| ------------- | :------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        |    ✅    | Identifier used in tool calls and `--agent`                                                                                                                                                     |
| `description` |    ✅    | Shown to parent agent unless `hidden: true`                                                                                                                                                     |
| `meta`        |          | Author note; not surfaced to runtime or parent                                                                                                                                                  |
| `hidden`      |          | Hides from inventory; agent remains discoverable and callable                                                                                                                                   |
| `tools`       |          | Comma-separated. Omit → empty tool set. Extension tools (`subagent`) must be listed explicitly                                                                                                  |
| `model`       |          | Optional model policy. Omit to inherit the parent/default model. Use a non-empty string, `{ id, when? }`, or a non-empty ordered list of strings/objects. Append `:low` etc. for thinking level |

Canonical Pi tool names: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. Some legacy Claude names are normalized but prefer Pi names.

Model policy examples:

```yaml
model: openai/gpt-5.4-mini:low
```

```yaml
model:
  - id: deepseek/deepseek-v4:high
    when: "!$IS_WORK"
  - openai/gpt-5.4-mini:low
```

Supported `when` expressions are `$VAR`, `!$VAR`, `$VAR == "value"`, and `$VAR != 'value'`. Env vars are truthy when present and not one of `false`, `0`, `no`, or `off` (case-insensitive); empty or missing vars are false. Invalid declared model policy fails startup instead of silently inheriting a model. Declared candidates are checked against Pi's active model registry; if no candidate is valid for the current runtime, startup fails with the agent name and source path.

Delegated `subagent` calls validate model policy only for the requested target. A hot-reloaded unrelated broken agent does not block a valid selected agent. When the target has declared candidates, the child `pi` process still runs with `--agent <name>` and also receives each selected candidate as explicit `--model`; candidate-local thinking is passed as `--thinking` only when the candidate includes a thinking suffix. Transient provider failures (timeouts/network interruptions, rate limits/429s, and 5xx/overloaded/unavailable responses) retry the same candidate up to three total attempts, then advance. Deterministic provider/model availability failures (auth/API key, unavailable/not found/gated models, quota/funds exhaustion) advance immediately. Context-window overflow is terminal and asks the caller to reduce scope; task, tool, validation, aborted, and ordinary non-provider failures do not advance the model chain. Success returns only the successful child output, without attempt chatter. Compact attempt metadata is kept for humans in the UI/session manifest: attempted model, per-candidate attempt number, success, exit code, short error summary, and retryable marker. Agents that omit `model` keep the inherited/default child invocation with no explicit model or thinking flags from this feature. Swarms validate each member independently: valid members run, invalid members return `<member status="error">` blocks, and the swarm still succeeds when at least one member returns output.

---

## Swarm discovery

A swarm is a named target made of member agent names:

```json
{
	"name": "review",
	"description": "Run the configured review panel",
	"members": ["correctness-review", "security-review", "maintainability-review"],
	"hidden": false
}
```

Directory layout:

```text
.pi/swarms/
  review/
    swarm.json
    correctness-review.md
    security-review.md
```

`swarm.json` must include `name`, `description`, and `members` (string array of member names).
Swarms are advertised in the same parent `available-subagents` inventory as single agents.
Swarm-folder markdown files are loaded as agent configs during discovery and can be referenced by member names.
Hidden swarms (`hidden: true`) are omitted from that inventory but stay visible in `/debug-agents` output and executable by explicit name.

---

## `subagent` tool

Spawns one `pi` subprocess with an isolated context window. Each tool call runs one delegated target. When a discovered swarm is provided, the extension dispatches one subprocess per swarm member concurrently in the same call, then aggregates member results. Pi may dispatch multiple independent `subagent` tool calls concurrently; this extension does not batch or schedule them internally. The parent sees only the child's final message, not the full transcript.

```json
{
	"agent": "scout",
	"description": "map auth flow",
	"task": "...",
	"cwd": "/path",
	"resume": "optional-id-from-previous-result"
}
```

All four fields (`agent`, `description`, `task`, `cwd`) are required. `resume` is optional.

- For a follow-up of a single-agent target, provide the exact session UUID in `<subagent-resume-id>`.
- For a follow-up swarm, provide the prior friendly swarm resume ID (for example `swarm-review-...`).
- Fresh single-agent calls run as fresh sessions unless the parent prompt appears follow-up-like, in which case the latest prior child session for the same agent is auto-resumed.
- Fresh swarm calls run as fresh unless the parent prompt appears follow-up-like, in which case the latest prior swarm resume entry is auto-resumed.

If a follow-up depends on that ID, wait for the first tool result before making the second call; do not dispatch both calls concurrently. Never use a placeholder or empty resume value, and never dispatch the follow-up before the first result returns. `description` should be 3–8 words. Dispatch multiple independent subagents concurrently as separate tool calls when no later call depends on another run's resume ID.

A resumed swarm may render missing member sessions as errors when the manifest references a member that no longer has an available session. Runtime model-policy failures are rendered the same way for individual swarm members, preserving partial results from valid members.

Collapsed swarm UI shows one swarm-level header, a four-line preview of the shared prompt, a ticking total duration, compact member status lines, and inline member errors. Expanding the tool result shows the full shared prompt and full error lines.

Swarm result blocks are emitted as XML member entries with CDATA-wrapped final output:

```xml
<member name="correctness-review" status="ok"><![CDATA[
...review output...
]]></member>

<member name="security-review" status="error" resume="true"><![CDATA[
No session found for swarm member "security-review" in resume "swarm-review-...".
]]></member>
```

**Usage hints:**

- _"Use the scout agent to map the folder structure"_
- _"Ask fixer to repair the typecheck failure"_

---

## `--agent <name>` direct mode

Adopts a discovered agent's config into the current top-level session:

- prompt body → appended as `<system-reminder type="selected-agent-prompt">`
- `model` → first valid declared candidate for the active Pi runtime
- selected candidate thinking suffix (`:low`) → Pi thinking level
- `tools` → active tool set

Explicit CLI flags always win over inherited agent fields:

| CLI flag                | Overrides                |
| ----------------------- | ------------------------ |
| `--model`, `--provider` | inherited model          |
| `--thinking`            | inherited thinking level |
| `--tools`, `--no-tools` | inherited tool set       |

A missing agent name, invalid declared model policy, unavailable candidate chain, or missing credentials while applying the selected candidate is a hard failure. Pass `--model` or `--provider` to suppress agent-declared model policy for direct mode.

```sh
pi --agent scout "Map the retry flow"
pi --agent fixer --model openai/gpt-5 "Fix typecheck failures"
pi --agent scout --tools read,bash,edit "Override the inherited tool set"
```

---

## Session logs

When the parent session is persisted, each subagent run is saved under:

```text
~/.pi/agent/subagent-sessions/
  --<cwd-encoded>--/
    <parent-session-id>/
      manifest.json            # one entry per single-agent run (agent, cost, duration, exit code, session filename, compact attempts)
      swarm-manifest.json      # one entry per swarm run (friendly swarm resume ID, target, member sessions)
      <uuid>.jsonl            # one per single-agent child process session
      <uuid>.jsonl            # additional files for resumed or parallel member sessions
```

Single-agent manifests include compact model-chain attempt records when a chain ran. They do not duplicate child transcripts; the `.jsonl` session files remain the transcript source.

Single-agent resumes use exact IDs from `manifest.json` (matched to session files by stored session UUID).
Swarm resumes use friendly IDs like `swarm-<target>-<uuid>` stored in `swarm-manifest.json`; each entry maps every member to its child session ID and session file.
A resumed swarm marks only members that successfully loaded a prior child session with `resume="true"`.

If the parent runs with `--no-session`, subagents also skip persistence and no resume ID is returned.

In the Pi UI, subagent runs are labeled as `(fresh)` or `(resumed)` and show the child model as `model:thinking` beside the agent name, without the provider. Model-chain runs also show concise operational metadata such as the final attempted candidate and failed attempt count. The child session ID appears after that metadata, but is hidden when the terminal is too narrow. Collapsed previews show only the latest 3 activity items; expanded views show the delegated prompt plus the final output, while inner tool-call activity stays in that same collapsed preview form.

---

## Debug

```
/debug-agents
```

Sends discovered agent + swarm inventory into the conversation, including effective and user/project sections, project swarm/agent directory paths, and member lists for each swarm.

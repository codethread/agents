# `subagent`

> Delegate one task to one specialized agent or swarm with isolated context.

Provides two things: the `subagent` tool for delegating work from within a session, and `--agent <name>` for adopting a single-agent config directly at startup. It also accepts repeatable `--agents-dir <path>` roots for loading extra external agents and swarms.

Discovered agents and swarms are injected into the system prompt as an `<available-subagents>` catalog nested under the `subagent` tool entry, so the parent agent can choose among them where tool guidance is defined. Agents or swarms marked `hidden: true` are callable by name but omitted from that inventory. Discovery is evaluated on demand, so edits to agent markdown or swarm definitions are picked up on the next call. Child processes are tagged `PI_SUBAGENT=1` so extensions can reshape behavior in delegated runs.

Agents are discovered from `agents/` directories, while swarms are discovered from `swarms/` directories; these are separate discovery roots in the same working tree. When a custom user agents directory is supplied programmatically, the default user swarms directory is resolved as its sibling `swarms/` directory so isolated test or embedded catalogs do not accidentally load the real user swarm catalog.

---

## Agent discovery

Four sources merge in priority order — latest `--agents-dir` wins over earlier `--agents-dir`, which wins over project, user, extension roots, then explicit package defaults used by tests/embedders:

| Source    | Location / behavior                                                                   |
| --------- | ------------------------------------------------------------------------------------- |
| Extension | local loaded extension/package roots contribute `<root>/agents/` and `<root>/swarms/` |
| User      | `~/.pi/agent/agents/`                                                                 |
| Project   | `.pi/agents/` (nearest ancestor of `cwd`)                                             |
| Flag      | each `--agents-dir <root>` contributes `<root>/agents/` and `<root>/swarms/` roots    |

Extension roots are inferred from local path sources in `--extension` / `-e`, `settings.json` `extensions`, and local `settings.json` `packages` entries. Non-local npm/git sources are ignored by this inference. Resource entries with `+` are accepted; `-` and `!` entries are treated as disables/exclusions and ignored. The extension no longer auto-loads this package's `pi/agents/` directory by default; ship agents under a local extension/package root's direct `agents/` directory or pass `--agents-dir` explicitly.

`--agents-dir` is repeatable. Each supplied path is shell-expanded (`~`, `$HOME`, `${VAR}`, etc.) and resolved once at startup; later flags override earlier ones for same-name agents or swarms.

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
mcpServers:
  - my-server:
      type: http
      url: https://example.com/mcp
---

You are a specialist in [whatever]...
```

| Field             | Required | Notes                                                                                                                                                                                                                                                                            |
| ----------------- | :------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            |    ✅    | Identifier used in tool calls and `--agent`                                                                                                                                                                                                                                      |
| `description`     |    ✅    | Shown to parent agent unless `hidden: true`                                                                                                                                                                                                                                      |
| `meta`            |          | Author note; not surfaced to runtime or parent                                                                                                                                                                                                                                   |
| `hidden`          |          | Hides from inventory; agent remains discoverable and callable                                                                                                                                                                                                                    |
| `tools`           |          | Comma/space-separated string or array. Omit → empty tool set. Claude Code names map through `~/.pi/agent/extensions/pi-subagent/settings.json`; permission patterns like `Bash(git:*)` are reduced to `Bash`. Extension tools (`subagent`) must be listed explicitly             |
| `disallowedTools` |          | Optional denylist using the same syntax and mapping as `tools`; removed from the final allowlist                                                                                                                                                                                 |
| `model`           |          | Optional model policy. Omit to inherit the parent/default model. Use a non-empty string, `{ id, when? }`, or a non-empty ordered list of strings/objects. Claude aliases (`sonnet`, `haiku`, etc.) map through the compatibility settings; append `:low` etc. for thinking level |
| `effort`          |          | Optional Claude Code effort hint mapped to Pi thinking (`low`, `medium`, `high`, `xhigh`, `max` by default) and applied when the model does not already include a thinking suffix                                                                                                |
| `mcpServers`      |          | Optional Claude Code-style list of MCP servers. Their tools are connected and exposed under `mcp__<server>__<tool>` when the agent is spawned or adopted. See [MCP servers](#mcp-servers)                                                                                        |

Canonical Pi tool names: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `subagent`. Claude Code compatibility settings are created automatically at `~/.pi/agent/extensions/pi-subagent/settings.json`; edit that file to change tool/model/effort mappings. Unrecognized or `null`-mapped Claude tools are ignored.

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

---

## MCP servers

Agents may declare [MCP](https://modelcontextprotocol.io) servers in Claude Code-style frontmatter. `mcpServers` is a **YAML list of single-key maps**, where each key is the server name and its value is the server config:

```markdown
---
name: jira-mcp
description: All things Jira
tools: bash, read, write
mcpServers:
  - atlassian:
      type: http
      url: https://mcp.atlassian.com/v1/mcp
---

You perform Jira operations using the Atlassian MCP tools.
```

Two transport shapes are supported:

| Shape           | Keys                                                      | Notes                                                                |
| --------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| Remote HTTP/SSE | `type` (`http`\|`sse`, default `http`), `url`, `headers?` | `streamable-http` is accepted as an alias for `http`                 |
| Local stdio     | `command`, `args?`, `env?`                                | Spawns a child process; `env` merges over a safe default environment |

```yaml
mcpServers:
  - context7:
      command: npx
      args:
        - "-y"
        - "@upstash/context7-mcp"
```

Behavior:

- When an agent is **spawned** (delegated via `subagent`) or **adopted** (`--agent <name>`), each configured server is connected and its tools are registered with the session, namespaced as `mcp__<server>__<tool>` to avoid collisions. The namespaced names are added to the agent's active tool set even when the agent frontmatter `tools` field declares a restrictive allowlist. Explicit CLI tool overrides (`--tools` / `--no-tools`) remain authoritative and skip MCP setup.
- A **malformed** `mcpServers` block (not a list, multiple keys per entry, unknown keys, unsupported `type`, missing `url`/`command`, mixed remote/stdio fields, duplicate names, non-string `args`/`headers`) is recorded as a per-agent error during discovery. Discovery is not aborted, but adopting that agent (or `/debug-mcp`) reports the error clearly instead of silently ignoring it.
- A server that **fails to connect** at adoption time (for example a remote server returning an auth error in headless mode) is surfaced as a non-fatal warning, both to the host (UI notification / stderr) and to the adopted agent's own conversation via an `<system-reminder type="mcp-status">` block so it can report the failure instead of fabricating data. The agent still runs with whatever connected.

> **Trust note.** A local stdio server (`command`/`args`/`env`) is launched as a child process **at session start** whenever its agent is adopted or delegated to — before any model turn. This is a stronger trust boundary than prompt-only or built-in-tool agents, which only run code when the model decides to call a tool. Discovery loads agents from the nearest `.pi/agents` of the current working tree, so only adopt/delegate to agents from `mcpServers` definitions you trust, the same way you would trust any executable in the repo. Remote (`http`/`sse`) servers do not spawn local processes.

### Debug / smoke test

Connect an agent's MCP servers headlessly and print the tools (or the connection error) without starting a conversation:

```sh
pi --debug-mcp jira-mcp        # prints the report and exits
```

```
/debug-mcp jira-mcp            # in-session; renders a hidden debug panel
```

For the bundled `jira-mcp` agent the Atlassian server requires OAuth, so a headless run returns a clear `invalid_token` / "Missing or invalid access token" error. That is the expected acceptance signal — it confirms the config parsed, the transport connected, and the server rejected the unauthenticated request without requiring an interactive OAuth flow.

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
- `--agents-dir` roots participate in discovery here too, with the same precedence used by delegated subagents, `/debug-agents`, `/debug-mcp`, and parent prompt injection

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
pi --agents-dir ~/shared-subagents --agent review "Use an external review panel"
```

> **Persistence note.** `--continue` / `--resume` do not automatically remember prior `--agents-dir` values. Pass the same `--agents-dir` flags again when resuming if you need the same external catalog.

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

Single-agent resumes use exact IDs from `manifest.json` (matched to session files by stored session UUID and passed to Pi with `--session-id`).
Swarm resumes use friendly IDs like `swarm-<target>-<uuid>` stored in `swarm-manifest.json`; each entry maps every member to its child session ID and session file.
A resumed swarm marks only members that successfully loaded a prior child session with `resume="true"`.

If the parent runs with `--no-session`, subagents also skip persistence and no resume ID is returned.

In the Pi UI, subagent runs are labeled as `(fresh)` or `(resumed)` and show the child model as `model:thinking` beside the agent name, without the provider. Model-chain runs also show concise operational metadata such as the final attempted candidate and failed attempt count. The child session ID appears after that metadata, but is hidden when the terminal is too narrow. Collapsed previews show only the latest 3 activity items; expanded views show the delegated prompt plus the final output, while inner tool-call activity stays in that same collapsed preview form.

---

## Debug

```
/debug-agents
```

Shows discovered agent + swarm inventory in a hidden debug panel, including effective, extension, user, and project sections, extension root inference, project swarm/agent directory paths, and member lists for each swarm. Press `Ctrl+G` to open the markdown in your external editor, or `Ctrl+Enter` to intentionally send it to the agent.

```
/debug-mcp <agent>
```

Connects the named agent's MCP servers and reports the discovered tools or the connection error in a hidden debug panel (`--debug-mcp <agent>` does the same headlessly and exits). Run `/debug-mcp` with no argument to list agents that declare `mcpServers`.

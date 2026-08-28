# `subagent`

> Delegate one task to one specialized agent or swarm with isolated context.

Provides two things: the `subagent` tool for delegating work from within a session, and `--agent <name>` for adopting a single-agent config directly at startup. Local extension/package paths provide agent and swarm catalogs from their direct `agents/` and `swarms/` directories.

When the `subagent` tool is active, discovered agents and swarms are injected into the system prompt as an `<available-subagents>` catalog nested under its tool entry, so the parent agent can choose among them where tool guidance is defined. Disabling the tool, including with `--exclude-tools subagent`, also omits the catalog. Free-text descriptions are wrapped in CDATA so example XML snippets remain readable while the catalog stays XML-valid. Agents or swarms marked `hidden: true` are callable by name but omitted from that inventory. Discovery is evaluated on demand, so edits to agent markdown or swarm definitions are picked up on the next call. Child processes are tagged `PI_SUBAGENT=1` so extensions can reshape behavior in delegated runs.

Agents are discovered from `agents/` directories, while swarms are discovered from `swarms/` directories; these are separate discovery roots in the same working tree. When a custom user agents directory is supplied programmatically, the default user swarms directory is resolved as its sibling `swarms/` directory so isolated test or embedded catalogs do not accidentally load the real user swarm catalog.

---

## Agent discovery

Three sources merge in priority order — project wins over user, which wins over extension roots; explicit package defaults remain available to tests/embedders:

| Source    | Location / behavior                                                                   |
| --------- | ------------------------------------------------------------------------------------- |
| Extension | local loaded extension/package roots contribute `<root>/agents/` and `<root>/swarms/` |
| User      | `~/.pi/agent/agents/`                                                                 |
| Project   | `.pi/agents/` (nearest ancestor of `cwd`)                                             |

Extension roots are inferred from local path sources in `--extension` / `-e`, `settings.json` `extensions`, and local `settings.json` `packages` entries. Non-local npm/git sources are ignored by this inference. Resource entries with `+` are accepted; `-` and `!` entries are treated as disables/exclusions and ignored. The extension no longer auto-loads this package's `pi/agents/` directory by default; ship agents under a local extension/package root's direct `agents/` directory.

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

| Field             | Required | Notes                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | :------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            |    ✅    | Identifier used in tool calls and `--agent`                                                                                                                                                                                                                                                                                                                                        |
| `description`     |    ✅    | Shown to parent agent unless `hidden: true`                                                                                                                                                                                                                                                                                                                                        |
| `meta`            |          | Author note; not surfaced to runtime or parent                                                                                                                                                                                                                                                                                                                                     |
| `hidden`          |          | Hides from inventory; agent remains discoverable and callable                                                                                                                                                                                                                                                                                                                      |
| `tools`           |          | Comma/space-separated string or array. Omit → empty tool set. Claude Code names map through `~/.pi/agent/extensions/pi-subagent/settings.json`; permission patterns like `Bash(git:*)` are reduced to `Bash`. Other names are preserved for custom/extension tools and enabled only when registered in the current runtime. Extension tools (`subagent`) must be listed explicitly |
| `disallowedTools` |          | Optional denylist using the same syntax and mapping as `tools`; removed from the final allowlist                                                                                                                                                                                                                                                                                   |
| `model`           |          | Optional model policy. Omit to inherit the parent/default model. Use a non-empty string, `{ id, when? }`, or a non-empty ordered list of strings/objects. Claude aliases (`sonnet`, `haiku`, etc.) map through the compatibility settings; append `:low` etc. for thinking level                                                                                                   |
| `effort`          |          | Optional Claude Code effort hint mapped to Pi thinking (`low`, `medium`, `high`, `xhigh`, `max` by default) and applied when the model does not already include a thinking suffix                                                                                                                                                                                                  |
| `mcpServers`      |          | Optional Claude Code-style list registered with `pi-mcp-adapter`. The agent accesses them through `mcp` or `mcpScript`. See [MCP servers](#mcp-servers)                                                                                                                                                                                                                            |

Canonical Pi tool names: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `subagent`. Claude Code compatibility settings are created automatically at `~/.pi/agent/extensions/pi-subagent/settings.json`; edit that file to change tool/model/effort mappings. A `null`-mapped Claude tool is ignored. Other names are treated as custom/extension tools, so use the extension's exact registered tool name (for example, `pi-internals`).

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

Agents may declare MCP servers in Claude Code-style frontmatter. `mcpServers` is a **YAML list of single-key maps**:

```yaml
mcpServers:
  - context7:
      command: bunx
      args:
        - "-y"
        - "@upstash/context7-mcp"
```

Remote HTTP/SSE definitions accept `type`, `url`, and optional string `headers`. Local stdio definitions accept `command`, optional string-array `args`, and optional string-map `env`. Malformed definitions are recorded during discovery and fail when that agent is selected.

MCP transport and tool execution are provided by [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter), which must be installed separately. On agent startup this extension parses the frontmatter and registers each definition through the adapter's versioned runtime-registration event. The adapter then owns lazy connection, authentication, approval, metadata caching, output guarding, and cleanup.

Runtime-registered servers are proxy-only. Agents that declare `mcpServers` automatically receive the adapter's `mcp` and `mcpScript` tools in addition to their configured tool allowlist. Agent prompts should discover and invoke server tools through `mcp`; use `mcpScript` for multi-call loops, filtering, or chaining. They should not refer to direct `mcp__<server>__<tool>` names.

Explicit CLI tool overrides (`--tools` / `--no-tools`) remain authoritative and skip MCP registration. Duplicate names against the adapter's effective config fail closed. Registrations are session-scoped and disposed during shutdown; they are never written to MCP config files.

> **Trust note.** A local stdio server can execute the declared command when first used. Only adopt or delegate to agents whose MCP definitions you trust.

### Debug registration

Verify that an agent's frontmatter parses and that the installed adapter accepts each runtime registration, without connecting the lazy servers:

```text
pi --debug-mcp nerd
/debug-mcp nerd
```

The debug command deliberately tests the integration boundary rather than duplicating the adapter's connection and tool-list tests. Use `/mcp`, `mcp({ server: "<name>" })`, or `mcp({ connect: "<name>" })` for adapter status and live connection diagnostics.

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

Spawns one `pi` subprocess with an isolated context window, including from Bun standalone builds without forwarding Bun's virtual `/$bunfs/...` entrypoint as prompt text. Each tool call runs one delegated target. When a discovered swarm is provided, the extension dispatches one subprocess per swarm member concurrently in the same call, then aggregates member results. Pi may dispatch multiple independent `subagent` tool calls concurrently; this extension does not batch or schedule them internally. The parent sees only the child's final message, not the full transcript.

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
pi -e ~/shared-subagents --agent review "Use an external review panel"
```

> **Persistence note.** `--continue` / `--resume` do not automatically remember one-off `-e` extension paths. Pass the same `-e` flags again when resuming if you need the same external catalog.

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

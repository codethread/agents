# Subagent Orchestration Specification

**Status:** Implemented
**Last Updated:** 2026-05-10

## 1. Overview

### Purpose

The subagent extension provides a stable runtime for delegating work to isolated Pi subprocesses while preserving enough structure for streaming progress, UI rendering, resume, and post-run inspection. This domain covers the `subagent` tool, the `debug-agents` command, and the direct top-level `--agent <name>` flag in `pi-extensions/tools/subagent/`. Each tool call runs one named target; the same `agent` parameter can resolve to a single-agent config or a configured parallel fan-out swarm target.

### Goals

- Execute delegated work in isolated child `pi` processes instead of the parent conversation context.
- Execute exactly one delegated target per `subagent` tool call; a target may be a single agent or a configured swarm.
- For swarm targets, run all member agents concurrently and return one grouped tool result after all members complete.
- Stream incremental progress back into the parent tool call while subprocesses are running.
- Preserve enough metadata per agent/swarm run to render useful collapsed and expanded TUI views.
- Reuse discovered agent configuration from the discovery layer without drifting between direct `--agent` mode and delegated child runs.
- Keep the delegation interface consistent and explicit by requiring a per-run label and working directory.
- Persist resume mappings so follow-up detection can resume prior agents/swarms after the parent Pi session is reopened.

### Non-Goals

- Discovering or normalizing agent/swarm definitions. That belongs to `pi-extensions/tools/subagent/agents.ts` and is specified in `specs/subagent--discovery-and-config.md`.
- Ad hoc scheduling or batching of arbitrary child agents inside one tool call. Swarm fan-out is allowed only through user-configured named swarm targets.
- Retrying failed agents or checkpointing intermediate state.
- Merging multiple agents into a shared in-process context. Isolation is process-based.
- Providing a security sandbox stronger than "separate process isolation".
- Supporting sequential handoff pipelines inside the tool API.
- Nesting swarms inside swarms.

## 2. Design Decisions

- **Decision:** Subagents run in separate `pi` subprocesses instead of nested in-process calls.
  - **Rationale:** This gives each delegated task an isolated context window and cleanly separates message streams from the parent conversation.

- **Decision:** Runtime discovery happens once per tool invocation before task execution.
  - **Rationale:** A single target resolution snapshot keeps execution consistent during the run, including current swarm member lists and project-agent directory metadata.

- **Decision:** Child Pi invocations always use JSON mode.
  - **Rationale:** The runtime depends on structured `message_end` and `tool_result_end` events for streaming updates, usage aggregation, and renderer-friendly result logs.

- **Decision:** Delegated child runs invoke `pi --agent <name>` instead of separately forwarding prompt/model/tools.
  - **Rationale:** This keeps direct top-level mode and delegated child execution on one inheritance path, which is required now that tool selection is an exact allowlist spanning both built-in and extension tools.

- **Decision:** Persist single-agent and swarm sessions only when the parent session is persisted, and index them via per-parent manifests.
  - **Rationale:** This preserves legacy ephemeral behavior for non-persisted runs while enabling structured post-run introspection (task summary, model, usage, cost, duration, and session file) whenever a parent session has a durable log.

- **Decision:** The `subagent` tool accepts one delegated target per invocation and relies on Pi's normal multi-tool dispatch for independent target-level concurrency.
  - **Rationale:** Pi can dispatch multiple independent tool calls concurrently, so the tool API should not accept arbitrary batches. A configured swarm is different: it is a user-defined target whose meaning is to run a fixed specialist panel in parallel. Resume IDs, however, only exist after a prior tool result returns, so follow-up calls must be sequential.

- **Decision:** Pi executes against one merged delegation target list rather than exposing source scopes or target kind in the tool API.
  - **Rationale:** Source distinctions and swarm membership are useful for debugging, but the parent agent should only decide which named capability it needs.

- **Decision:** Direct top-level `--agent` mode inherits all currently supported runtime-facing agent settings, while explicit CLI flags override matching fields only.
  - **Rationale:** The flag is meant to make the top-level session behave like the selected agent file, but users still need precise escape hatches for model, thinking, and tools without losing the rest of the inherited behavior. For tools specifically, the override is exact rather than additive: agent-selected tools are skipped entirely when `--tools` or `--no-tools` is present.

- **Decision:** The tool API uses required top-level `agent`, `description`, `task`, and `cwd` fields, with optional `resume`.
  - **Rationale:** The required shape names one delegation target. Fan-out is configured behind that target for swarms, not exposed as an ad hoc list in the tool call. Resume stays opt-in so the parent agent can choose between continuity and a fresh review.

- **Decision:** Rendering emphasizes assistant text and summarized tool calls, but single-run output falls back to the last tool-result text when that is the only final displayable child message.
  - **Rationale:** The tool aims to present concise operator-facing progress and outcomes, while still ensuring the parent agent sees the actual final child result instead of an empty placeholder.

- **Decision:** Expanded TUI views show the delegated prompt and final output, while inner child activity remains a short collapsed preview.
  - **Rationale:** Operators primarily need to verify what was asked and what came back. The full inner tool transcript is noisy, so expanded views should not explode into a raw nested session log.

- **Decision:** Swarm results are returned as one concatenated parent-visible response with one XML `<member>` block per member.
  - **Rationale:** The parent agent needs to see which specialist produced each output, including failures, without learning a new nested result schema. Existing tool-result rendering already provides the outer container.

- **Decision:** A failed swarm member does not fail the whole swarm when at least one member returns useful output.
  - **Rationale:** In a 4–5 member review panel, partial output still has value. The parent agent can see the `<member status="error">` gap and decide whether to retry or proceed.

- **Decision:** Swarm resume uses one friendly resume ID that maps to every member's child session in a persisted swarm manifest.
  - **Rationale:** The parent agent should not track N child session IDs. A resumed swarm should fire all members concurrently with the same follow-up prompt; each member can answer or ignore based on relevance.

- **Decision:** Auto-resume state is persisted in manifests and no process-local resume cache is authoritative.
  - **Rationale:** The current in-memory `lastSessionByAgent` behavior loses continuity when the user resumes the parent session on another day. Parent session ID plus cwd already gives a stable key for durable lookup.

## 3. Architecture

Subagent orchestration lives in `pi-extensions/tools/subagent/` and sits directly on top of the discovery/config layer from `./agents.js`.

### Extension surface

`export default function (pi: ExtensionAPI)` registers four entry points:

1. `--agent <name>` CLI flag — validates one requested discovered single-agent name at session start and applies inherited runtime settings from that agent file unless explicit CLI flags override those fields.
2. `before_agent_start` hook — discovers targets, appends a `<system-reminder type="available-subagents">` block containing an inner XML `<available-subagents>` list of visible agent/swarm names/descriptions to the parent system prompt, and when `--agent` is set appends the selected agent prompt body inside `<system-reminder type="selected-agent-prompt">` too.
3. `debug-agents` command — reports the effective merged target list plus separate user/project source sections.
4. `subagent` tool — validates parameters, resolves the requested name through discovery, executes one delegated target, and renders the result in the Pi TUI.

### Runtime pipeline

A `subagent` execution follows this flow:

1. Call discovery once for the run.
2. Validate the single-target payload.
3. Resolve `params.agent` to either a single agent or a swarm.
4. Execute a single-agent target through `runSingleAgent(...)`, or execute a swarm target by launching `runSingleAgent(...)` once per member concurrently.
5. Stream updates as children emit results.
6. For each child, `runSingleAgent(...)`:
   - looks up the requested `AgentConfig`
   - builds a child `pi` invocation in JSON mode using `--agent <name>`
   - spawns a subprocess in the requested working directory
   - parses newline-delimited JSON events from stdout
   - accumulates messages, usage, provider/model metadata, and stop/error state
   - emits streaming updates through the tool callback
7. The tool wraps the child result(s) in `SubagentDetails`, which the renderer uses for collapsed and expanded display.

### Child process boundary

Subprocess execution is intentionally isolated from the parent context:

- the child is launched with `--mode json -p`
- when the parent session is persisted, each child subagent run gets a session path in a subagent session directory (`--session <path>`); otherwise it falls back to `--no-session`
- child subagents are marked with `PI_SUBAGENT=1` in the environment so extensions can adjust behavior for delegated runs
- the selected discovered agent is activated in the child through `--agent <name>`, so prompt/model/thinking/tool inheritance uses the same code path as top-level direct-agent mode
- the delegated work itself is passed as a single prompt string: `Task: <task>`

Invocation is environment-aware:

- if the current process is running from a real script path, the child reuses `process.execPath` plus that script path
- otherwise, if `process.execPath` is already a dedicated executable rather than `node`/`bun`, it is used directly
- otherwise the runtime falls back to invoking `pi`

This preserves local-dev behavior when the extension is being run from a repo checkout rather than an installed global binary.

### Mode orchestration

There is one orchestration shape: required top-level `agent`, `description`, `task`, and `cwd` fields. The `agent` value names one resolved delegation target, not necessarily one child process.

Behavioral details:

- a placeholder `SingleResult` is created up front with `exitCode: -1` and `agentSource: "unknown"` to support streaming UI updates
- a single-agent final tool response is the child's final displayable message (assistant text, or final tool-result text when the child ends on a tool result)
- a swarm final tool response concatenates one `<member>` XML block per member, preserving member name, status, optional resume marker, and raw final displayable output/error text
- persisted single-agent runs append a plain `Subagent resume ID: ...` line and `<subagent-resume-id>...</subagent-resume-id>` to the parent-visible final response
- persisted swarm runs append one friendly swarm resume ID using the same parent-facing resume tag convention; the friendly ID maps to all member sessions in the swarm manifest
- failed single-agent child runs set the overall tool call `isError` and return the full error text
- runtime model-policy validation is scoped to the requested single agent or requested swarm members; unrelated invalid discovered agents do not block a delegated run
- invalid swarm member model policy is represented as that member's failed `SingleResult`, so valid members can still run
- swarm runs with at least one successful member return partial output without marking the whole tool call as an error; an all-failed swarm may set `isError`

### Session logging

When the parent session is persisted, subagent runs are also persisted and indexed through manifests. The parent session ID and cwd form the stable lookup key, so resume mappings survive Pi restarts and later `--session`/`--continue` use of the same parent session.

Storage layout:

```text
~/.pi/agent/subagent-sessions/
  --<cwd-encoded>--/
    <parent-session-id>/
      manifest.json
      swarm-manifest.json
      <uuid>.jsonl
      <uuid>.jsonl
```

`<cwd-encoded>` follows Pi's session directory naming convention: strip a leading root separator, replace path separators with `-`, then wrap with `--`.

For each subagent run, the runtime:

1. generates a UUID (`crypto.randomUUID()`) used as both manifest entry `id` and session filename (`<uuid>.jsonl`)
2. launches the child process with `--session <absolute path>`
3. records the completed run in `manifest.json` (upsert by `id`)

Manifest contract:

```ts
interface ManifestEntry {
	id: string;
	agent: string;
	agentSource: string;
	provider?: string;
	model?: string;
	thinking: string | null;
	description: string;
	prompt: string;
	sessionFile: string;
	timestamp: string;
	exitCode: number;
	usage: { input: number; output: number; cost: number };
	durationMs: number;
}

interface Manifest {
	parent: { sessionFile: string; sessionId: string };
	cwd: string;
	subagents: ManifestEntry[];
}
```

`description` is required for every delegated task.

Swarm manifest contract:

```ts
interface SwarmManifestMember {
	name: string;
	sessionId?: string;
	sessionFile?: string;
	lastExitCode: number;
}

interface SwarmManifestEntry {
	id: string;
	target: string;
	description: string;
	prompt: string;
	timestamp: string;
	members: SwarmManifestMember[];
}

interface SwarmManifest {
	parent: { sessionFile: string; sessionId: string };
	cwd: string;
	swarms: SwarmManifestEntry[];
}
```

The swarm `id` is a friendly parent-visible resume ID (for example `swarm-review-<uuid>`). It maps one-to-many to member `sessionId`/`sessionFile` entries and does not need to match any child session UUID.

Fallback behavior: if the parent has no persisted session file, subagents and swarms use `--no-session` and no manifest is written.

Auto-resume behavior:

- explicit `resume` always wins
- for a follow-up-looking single-agent call without `resume`, load `manifest.json` and resume the latest matching prior agent run when available; otherwise run fresh
- for a follow-up-looking swarm call without `resume`, load `swarm-manifest.json` and resume the latest matching prior swarm target when available; otherwise run fresh
- process-local caches such as `lastSessionByAgent` are not authoritative and should be removed rather than used as resume state

### Streaming event handling

`runSingleAgent(...)` treats child stdout as a stream of JSON events delimited by newlines.

Recognized events:

- `message_end` with `event.message`
- `tool_result_end` with `event.message`

All other lines, including malformed JSON, are ignored.

For assistant `message_end` events, the runtime:

- appends the message to `messages`
- increments `usage.turns`
- accumulates input/output/cache/cost counters from `msg.usage`
- records `usage.contextTokens` from the latest `usage.totalTokens`
- records provider/model metadata when present
- resolves model registry metadata for context window, reasoning support, and subscription usage
- computes `contextPercent` when both current token count and context window are known
- stores `stopReason` and `errorMessage` when present

For `tool_result_end`, the message is appended to the run log and an update is emitted, but rendering later focuses on assistant text/tool-call parts, with a fallback to the last displayable tool-result text when that is the only final output.

### Rendering pipeline

The subagent tool owns both call rendering and result rendering.

- `renderCall(...)` prints a compact preview of the requested target and task.
- `renderResult(...)` consumes `SubagentDetails` and renders one or more child runs' status/output for running and completed workloads.
- Shared usage strings come from `formatUsageStats(...)`, which delegates token/cost/model formatting to `pi-extensions/ui/statusline/usage-format.ts`.
- Tool-call summaries come from `formatToolCall(...)`, which special-cases built-ins like `bash`, `read`, `write`, `edit`, `find`, and `grep`.

Expanded views use `Container`, `Text`, `Spacer`, and `Markdown` components to show the delegated prompt, member/agent names plus child session IDs, markdown-rendered final output, and usage stats. When a child has no final output yet, expanded views still keep inner activity collapsed to the same short preview used by collapsed mode. Collapsed views show shorter previews and always include an expand hint.

Parent-visible swarm output is plain text containing one block per member:

```xml
<member name="correctness-review" status="ok"><![CDATA[
...review content as returned by correctness-review...
]]></member>

<member name="security-review" status="error">
<![CDATA[
...error details, such as API limit hit or no session found...
]]></member>
```

For resumed swarm members, include `resume="true"` on members that successfully used an existing child session:

```xml
<member name="correctness-review" status="ok" resume="true"><![CDATA[
...follow-up content...
]]></member>
```

## 4. Data Model

Core runtime shapes defined in the subagent runtime:

```ts
interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	contextWindow?: number;
	contextPercent?: number | null;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "package" | "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	sessionFile?: string;
	sessionId?: string;
	provider?: string;
	model?: string;
	reasoning?: boolean;
	usingSubscription?: boolean;
	thinkingLevel?: string;
	stopReason?: string;
	errorMessage?: string;
}

interface SubagentDetails {
	projectAgentsDir: string | null;
	parentSessionId?: string;
	results: SingleResult[];
}
```

Swarm execution keeps using `results: SingleResult[]` for member runs.

```ts
interface SwarmRunDetails {
	target: string;
	resumeId?: string;
	members: SingleResult[];
}
```

The important contract is parent-visible and persistent: one target-level swarm resume ID maps to the member `SingleResult.sessionId` values stored in `swarm-manifest.json`.

Tool parameter schema:

```ts
const SubagentParams = Type.Object({
	agent: Type.String(),
	description: Type.String(),
	task: Type.String(),
	cwd: Type.String(),
	resume: Type.Optional(Type.String()), // exact value from prior <subagent-resume-id>; may be a single-agent UUID or friendly swarm ID
});
```

Operational constants:

```ts
const COLLAPSED_ITEM_COUNT = 3;
const RUNNING_EXIT_CODE = -1;
```

Notable conventions:

- `agentSource: "unknown"` is used for unknown-agent failures and for the in-flight placeholder before discovery metadata is available.
- `exitCode: -1` is reserved for a placeholder entry that is still running.
- `thinkingLevel` is derived from `agent.model?.split(":").at(1)` before the subprocess runs; resolved provider/model values may later replace runtime display metadata.
- swarm member failures are represented as `SingleResult` values with non-zero `exitCode`; they render as `<member status="error">` rather than being dropped.

## 5. Interfaces

### `--agent <name>` direct mode

At session start, the extension reads the registered `agent` CLI flag.
If the flag is present, it discovers agents for `ctx.cwd`, validates that the requested name exists in the effective merged single-agent catalog, and exits with an error if it does not. Swarm targets are not valid direct `--agent` selections.

If the flag is present, the extension then derives inherited runtime settings from the selected `AgentConfig` and applies them to the parent session unless explicit CLI flags override the corresponding field.
Today that inherited runtime surface includes:

- model
- thinking level parsed from the model suffix
- the exact tool allowlist across built-in and extension tools
- prompt body

Override rules are per-field:

- `--model` / `-m` or `--provider` suppress inherited agent model selection
- `--thinking` suppresses inherited agent thinking level
- `--tools` or `--no-tools` suppress inherited agent tool selection entirely; the CLI tool set is treated as the final PUT-style value

If a requested agent name is missing, or if a still-inherited agent model cannot be applied in the active runtime, the extension fails hard with exit code `1` rather than silently falling back.

For each turn, `before_agent_start` then:

- appends the normal `<system-reminder type="available-subagents">` wrapper containing the `<available-subagents>` XML catalog for visible targets not marked `hidden: true`
- resolves the current selected single agent by name from a fresh discovery snapshot
- appends that agent's markdown body inside `<system-reminder type="selected-agent-prompt">` to the parent system prompt

This direct mode reuses discovery semantics from delegated runs and is intended to inherit the selected agent's full runtime behavior surface over time, not just today's prompt/model/tools fields.

### `debug-agents` command

`debug-agents` reads one discovery snapshot and formats a plain-text report containing:

- the effective merged list of available agents and swarms
- a separate user-agent section
- the resolved project agents/swarms directories, if any
- a separate project-agent section
- for each listed agent: name, source, file path, resolved model when present, and normalized tools
- for each listed swarm: name, source, file path, and resolved member names

If the parent context is not idle, the report is queued as a follow-up message and an informational UI notification is emitted when UI support exists.

### `subagent` tool execution contract

#### Input validation

The tool requires `agent`, `description`, `task`, and `cwd`.

#### Target discovery

At execution start, the tool resolves one target snapshot:

```ts
const discovery = discoverAgents(ctx.cwd);
const target = findDelegationTarget(discovery, params.agent);
```

Current single-agent execution uses `discovery.agents`. Swarm execution resolves `params.agent` against a collision-free target catalog. The runtime does not re-normalize tools or models. It assumes discovery already returned executable `AgentConfig` values and validated swarm membership.

#### Result contract

Execution:

- single-agent target: one child process runs per tool invocation
- swarm target: one child process runs per swarm member, concurrently, using the same task prompt
- streaming updates report running child/member status
- single-agent final content contains the child's full final displayable output
- swarm final content contains one `<member>` block per member, with `status="ok"` or `status="error"` and `resume="true"` when that member resumed an existing child session
- persisted single-agent runs append a plain resume-ID line plus a `<subagent-resume-id>` XML tag containing the subagent session ID so the parent can pass it back as `resume` later
- persisted swarm runs append a plain resume-ID line plus a `<subagent-resume-id>` XML tag containing the friendly swarm resume ID so the parent can pass it back as `resume` later

Failure model:

- a failed single-agent run returns full error text and sets top-level `isError`
- a swarm member failure renders that member as `<member status="error">...details...</member>`
- a resumed swarm with a missing member child session renders that member as an error, e.g. `no session found`
- a swarm with at least one successful member returns partial output without `isError`; a swarm with no successful members may set `isError`

### Internal execution helper: `runSingleAgent(...)`

`runSingleAgent(...)` is the orchestration core. Its contract is:

- if the requested agent name does not exist, return a failed `SingleResult` immediately without spawning a process
- otherwise spawn one child Pi process for the run
- honor the per-run `cwd` supplied in each task item
- when parent session info is available, create a subagent session path and run with `--session`; otherwise run with `--no-session`
- when `resume` is provided for a single-agent target, invoke Pi with `--session <resume> --session-dir <subagent-dir>` so Pi resolves the exact session ID
- when no `resume` is provided but the task looks like a follow-up, look up the latest matching agent in `manifest.json` and resume it when available
- on completion, update `manifest.json` with usage/cost/timing metadata for persisted subagent runs
- if an abort signal fires, send `SIGTERM` immediately and schedule a later `SIGKILL` attempt
- persist metadata for completed runs; no process-local resume state is authoritative

### Swarm execution helper

Swarm execution wraps `runSingleAgent(...)` rather than replacing it:

- resolve the swarm target to an ordered list of member names and run requests
- if explicit `resume` is provided, load that friendly swarm ID from `swarm-manifest.json`
- for each member, derive either an existing child session ID from the swarm manifest or a fresh child session path
- launch all members concurrently with the same `description`, `task`, and `cwd`
- preserve each member result independently, including failures and missing-session errors
- write/update one `swarm-manifest.json` entry mapping the friendly swarm resume ID to all member session IDs/files
- return parent-visible content as concatenated `<member>` blocks

## 7. Open Questions

- Should invalid-parameter and over-capacity responses be marked as tool errors instead of plain text results?
- Should the renderer surface structured tool-result messages directly in expanded views, or is assistant text plus tool-call summaries sufficient?
- Should friendly swarm resume IDs use human-readable prefixes such as `swarm-review-<shortid>`, or plain UUIDs stored in a swarm-specific manifest?

## 8. Code Locations

- `pi-extensions/README.md`
- `pi-extensions/tools/subagent/`
- `pi-extensions/tools/subagent/agents.ts` (runtime input boundary only)
- `pi-extensions/tools/subagent/runtime.ts`
- `pi-extensions/tools/subagent/session.ts`
- `pi-extensions/tools/subagent/render.ts`
- `pi-extensions/ui/statusline/usage-format.ts` (shared usage-display helpers consumed by subagent rendering)
- `pi-agents/*.md` (bundled agent definitions executed by this runtime)

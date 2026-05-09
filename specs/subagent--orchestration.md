# Subagent Orchestration Specification

**Status:** Implemented
**Last Updated:** 2026-04-19

## 1. Overview

### Purpose

The subagent extension provides a stable runtime for delegating work to isolated Pi subprocesses while preserving enough structure for streaming progress, UI rendering, and post-run inspection. This domain covers the `subagent` tool, the `debug-agents` command, and the direct top-level `--agent <name>` flag in `pi-extensions/subagent/`.

### Goals

- Execute delegated work in isolated child `pi` processes instead of the parent conversation context.
- Execute exactly one delegated task per `subagent` tool call; concurrent delegation is handled by Pi's normal concurrent tool-call dispatch.
- Stream incremental progress back into the parent tool call while subprocesses are running.
- Preserve enough metadata per agent run to render useful collapsed and expanded TUI views.
- Reuse discovered agent configuration from the discovery layer without drifting between direct `--agent` mode and delegated child runs.
- Keep the delegation interface consistent and explicit by requiring per-task labels and working directories.

### Non-Goals

- Discovering or normalizing agent definitions. That belongs to `pi-extensions/tools/subagent/agents.ts` and is specified in `specs/subagent--discovery-and-config.md`.
- Scheduling workloads or batching multiple child agents inside one tool call.
- Retrying failed agents, checkpointing intermediate state, or resuming partial runs.
- Merging multiple agents into a shared in-process context. Isolation is process-based.
- Providing a security sandbox stronger than "separate process isolation".
- Supporting sequential handoff pipelines inside the tool API.

## 2. Design Decisions

- **Decision:** Subagents run in separate `pi` subprocesses instead of nested in-process calls.
  - **Rationale:** This gives each delegated task an isolated context window and cleanly separates message streams from the parent conversation.

- **Decision:** Runtime discovery happens once per tool invocation before task execution.
  - **Rationale:** All task items use the same effective agent catalog and project-agent directory metadata; one snapshot keeps execution consistent during the run.

- **Decision:** Child Pi invocations always use JSON mode.
  - **Rationale:** The runtime depends on structured `message_end` and `tool_result_end` events for streaming updates, usage aggregation, and renderer-friendly result logs.

- **Decision:** Delegated child runs invoke `pi --agent <name>` instead of separately forwarding prompt/model/tools.
  - **Rationale:** This keeps direct top-level mode and delegated child execution on one inheritance path, which is required now that tool selection is an exact allowlist spanning both built-in and extension tools.

- **Decision:** Persist subagent sessions only when the parent session is persisted, and index them via a per-parent manifest.
  - **Rationale:** This preserves legacy ephemeral behavior for non-persisted runs while enabling structured post-run introspection (task summary, model, usage, cost, duration, and session file) whenever a parent session has a durable log.

- **Decision:** The `subagent` tool accepts one task per invocation.
  - **Rationale:** Pi can dispatch multiple tool calls concurrently, so batching subagents inside this tool duplicates orchestration semantics and hides concurrency from the parent runtime.

- **Decision:** Pi executes against one merged subagent list rather than exposing source scopes in the tool API.
  - **Rationale:** Source distinctions are useful for debugging and confirmation, but they do not need to complicate normal delegation.

- **Decision:** Direct top-level `--agent` mode inherits all currently supported runtime-facing agent settings, while explicit CLI flags override matching fields only.
  - **Rationale:** The flag is meant to make the top-level session behave like the selected agent file, but users still need precise escape hatches for model, thinking, and tools without losing the rest of the inherited behavior. For tools specifically, the override is exact rather than additive: agent-selected tools are skipped entirely when `--tools` or `--no-tools` is present.

- **Decision:** The tool API uses required top-level `agent`, `description`, `task`, and `cwd` fields.
  - **Rationale:** The input shape matches the single subprocess the tool owns and leaves fan-out to Pi's tool scheduler.

- **Decision:** Rendering emphasizes assistant text and summarized tool calls, but single-run output falls back to the last tool-result text when that is the only final displayable child message.
  - **Rationale:** The tool aims to present concise operator-facing progress and outcomes, while still ensuring the parent agent sees the actual final child result instead of an empty placeholder.

## 3. Architecture

Subagent orchestration lives in `pi-extensions/tools/subagent/` and sits directly on top of the discovery/config layer from `./agents.js`.

### Extension surface

`export default function (pi: ExtensionAPI)` registers four entry points:

1. `--agent <name>` CLI flag — validates one requested discovered agent name at session start and applies inherited runtime settings from that agent file unless explicit CLI flags override those fields.
2. `before_agent_start` hook — discovers agents, appends a `<system-reminder type="available-subagents">` block containing an inner XML `<available-subagents>` list of visible agent names/descriptions to the parent system prompt, and when `--agent` is set appends the selected agent prompt body inside `<system-reminder type="selected-agent-prompt">` too.
3. `debug-agents` command — reports the effective merged agent list plus separate user/project source sections.
4. `subagent` tool — validates parameters, resolves agents through discovery, executes one delegated task, and renders the result in the Pi TUI.

### Runtime pipeline

A `subagent` execution follows this flow:

1. Call `discoverAgents(ctx.cwd)` once for the run.
2. Validate the single-task payload.
3. Execute the requested task through `runSingleAgent(...)`.
4. Stream updates as the child emits results.
5. `runSingleAgent(...)`:
   - looks up the requested `AgentConfig`
   - builds a child `pi` invocation in JSON mode using `--agent <name>`
   - spawns a subprocess in the requested working directory
   - parses newline-delimited JSON events from stdout
   - accumulates messages, usage, provider/model metadata, and stop/error state
   - emits streaming updates through the tool callback
   - cleans up temporary prompt files afterward
6. The tool wraps the `SingleResult` in `SubagentDetails`, which the renderer uses for collapsed and expanded display.

### Child process boundary

Subprocess execution is intentionally isolated from the parent context:

- the child is launched with `--mode json -p`
- when the parent session is persisted, each subagent run gets `--session <path>` in a subagent session directory; otherwise it falls back to `--no-session`
- child subagents are marked with `PI_SUBAGENT=1` in the environment so extensions can adjust behavior for delegated runs
- the selected discovered agent is activated in the child through `--agent <name>`, so prompt/model/thinking/tool inheritance uses the same code path as top-level direct-agent mode
- the delegated work itself is passed as a single prompt string: `Task: <task>`

Invocation is environment-aware:

- if the current process is running from a real script path, the child reuses `process.execPath` plus that script path
- otherwise, if `process.execPath` is already a dedicated executable rather than `node`/`bun`, it is used directly
- otherwise the runtime falls back to invoking `pi`

This preserves local-dev behavior when the extension is being run from a repo checkout rather than an installed global binary.

### Mode orchestration

There is one orchestration shape: required top-level `agent`, `description`, `task`, and `cwd` fields.

Behavioral details:

- a placeholder `SingleResult` is created up front with `exitCode: -1` and `agentSource: "unknown"` to support streaming UI updates
- the final tool response is the child's final displayable message (assistant text, or final tool-result text when the child ends on a tool result)
- failed child runs set the overall tool call `isError` and return the full error text

### 2.5 Session Logging

When the parent session is persisted, subagent runs are also persisted and indexed through a manifest.

Storage layout:

```text
~/.pi/agent/subagent-sessions/
  --<cwd-encoded>--/
    <parent-session-id>/
      manifest.json
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

Fallback behavior: if the parent has no persisted session file, subagents use `--no-session` and no manifest is written.

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

- `renderCall(...)` prints a compact preview of the requested task list.
- `renderResult(...)` consumes `SubagentDetails` and renders per-task status/output for running and completed workloads.
- Shared usage strings come from `formatUsageStats(...)`, which delegates token/cost/model formatting to `pi-extensions/ui/statusline/usage-format.ts`.
- Tool-call summaries come from `formatToolCall(...)`, which special-cases built-ins like `bash`, `read`, `write`, `edit`, `find`, and `grep`.

Expanded views use `Container`, `Text`, `Spacer`, and `Markdown` components to show task text, tool-call summaries, markdown-rendered final output, and usage stats. Collapsed views show shorter previews and prompt the user to expand when content was truncated.

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

Tool parameter schema:

```ts
const SubagentParams = Type.Object({
	agent: Type.String(),
	description: Type.String(),
	task: Type.String(),
	cwd: Type.String(),
});
```

Operational constants:

```ts
const COLLAPSED_ITEM_COUNT = 10;
const RUNNING_EXIT_CODE = -1;
```

Notable conventions:

- `agentSource: "unknown"` is used for unknown-agent failures and for the in-flight placeholder before discovery metadata is available.
- `exitCode: -1` is reserved for a placeholder entry that is still running.
- `thinkingLevel` is derived from `agent.model?.split(":").at(1)` before the subprocess runs; resolved provider/model values may later replace runtime display metadata.

## 5. Interfaces

### `--agent <name>` direct mode

At session start, the extension reads the registered `agent` CLI flag.
If the flag is present, it discovers agents for `ctx.cwd`, validates that the requested name exists in the effective merged catalog, and exits with an error if it does not.

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

- appends the normal `<system-reminder type="available-subagents">` wrapper containing the `<available-subagents>` XML catalog for agents not marked `hidden: true`
- resolves the current selected agent by name from a fresh discovery snapshot
- appends that agent's markdown body inside `<system-reminder type="selected-agent-prompt">` to the parent system prompt

This direct mode reuses discovery semantics from delegated runs and is intended to inherit the selected agent's full runtime behavior surface over time, not just today's prompt/model/tools fields.

### `debug-agents` command

`debug-agents` reads one discovery snapshot and formats a plain-text report containing:

- the effective merged list of available agents
- a separate user-agent section
- the resolved project agents directory, if any
- a separate project-agent section
- for each listed agent: name, source, file path, resolved model when present, and normalized tools

If the parent context is not idle, the report is queued as a follow-up message and an informational UI notification is emitted when UI support exists.

### `subagent` tool execution contract

#### Input validation

The tool requires `agent`, `description`, `task`, and `cwd`.

#### Agent discovery

At execution start, the tool resolves:

```ts
const discovery = discoverAgents(ctx.cwd);
const agents = discovery.agents;
```

The runtime does not re-normalize tools or models. It assumes discovery already returned executable `AgentConfig` values.

#### Result contract

Execution:

- one child process runs per tool invocation
- streaming updates report the selected subagent as running
- final content contains the child's full final displayable output

Failure model:

- a failed child run returns full error text and sets top-level `isError`

### Internal execution helper: `runSingleAgent(...)`

`runSingleAgent(...)` is the orchestration core. Its contract is:

- if the requested agent name does not exist, return a failed `SingleResult` immediately without spawning a process
- otherwise spawn one child Pi process for the run
- honor the per-run `cwd` supplied in each task item
- when parent session info is available, create a subagent session path and run with `--session`; otherwise run with `--no-session`
- on completion, update `manifest.json` with usage/cost/timing metadata for persisted subagent runs
- if an abort signal fires, send `SIGTERM` immediately and schedule a later `SIGKILL` attempt
- clean up temporary prompt files/directories in a `finally` block regardless of outcome

## 7. Open Questions

- Should invalid-parameter and over-capacity responses be marked as tool errors instead of plain text results?
- Should the renderer surface structured tool-result messages directly in expanded views, or is assistant text plus tool-call summaries sufficient?

## 8. Code Locations

- `pi-extensions/README.md`
- `pi-extensions/tools/subagent/`
- `pi-extensions/tools/subagent/agents.ts` (runtime input boundary only)
- `pi-extensions/ui/statusline/usage-format.ts` (shared usage-display helpers consumed by subagent rendering)
- `pi-agents/*.md` (bundled agent definitions executed by this runtime)

# Subagent Orchestration Specification

**Status:** Implemented
**Last Updated:** 2026-04-12

## 1. Overview

### Purpose

The subagent extension provides a stable runtime for delegating work to isolated Pi subprocesses while preserving enough structure for streaming progress, UI rendering, and post-run inspection. This domain covers the `subagent` tool and the `debug-agents` command in `pi-extensions/extensions/subagent/`.

### Goals

- Execute delegated work in isolated child `pi` processes instead of the parent conversation context.
- Support bounded parallel fan-out using one consistent `tasks[]` invocation shape (including single-item runs).
- Stream incremental progress back into the parent tool call while subprocesses are running.
- Preserve enough metadata per agent run to render useful collapsed and expanded TUI views.
- Reuse discovered agent configuration from the discovery layer without reinterpreting prompt, tool, or model metadata at runtime.
- Keep the delegation interface consistent and explicit by requiring per-task labels and working directories.

### Non-Goals

- Discovering or normalizing agent definitions. That belongs to `pi-extensions/extensions/subagent/agents.ts` and is specified in `specs/agent-discovery-and-config.md`.
- Scheduling arbitrarily large workloads. Parallel work is intentionally capped and concurrency-limited.
- Retrying failed agents, checkpointing intermediate state, or resuming partial runs.
- Merging multiple agents into a shared in-process context. Isolation is process-based.
- Providing a security sandbox stronger than "separate process isolation".
- Supporting sequential handoff pipelines inside the tool API.

## 2. Architecture

Subagent orchestration lives in `pi-extensions/extensions/subagent/` and sits directly on top of the discovery/config layer from `./agents.js`.

### Extension surface

`export default function (pi: ExtensionAPI)` registers three entry points:

1. `before_agent_start` hook — discovers agents and appends an XML `<available_subagents>` list of names/descriptions to the parent system prompt.
2. `debug-agents` command — reports the effective merged agent list plus separate user/project source sections.
3. `subagent` tool — validates parameters, resolves agents through discovery, executes a `tasks[]` workload (1..N items), and renders results in the Pi TUI.

### Runtime pipeline

A `subagent` execution follows this flow:

1. Call `discoverAgents(ctx.cwd)` once for the run.
2. Validate the `tasks[]` payload (non-empty and within guardrails).
3. Execute the requested task list through the shared parallel orchestration path.
4. Stream per-task updates as results are produced.
5. Each individual agent run goes through `runSingleAgent(...)`, which:
   - looks up the requested `AgentConfig`
   - builds a child `pi` invocation in JSON mode
   - writes the agent system prompt to a temporary markdown file when non-empty
   - spawns a subprocess in the requested working directory
   - parses newline-delimited JSON events from stdout
   - accumulates messages, usage, provider/model metadata, and stop/error state
   - emits streaming updates through the tool callback
   - cleans up temporary prompt files afterward
6. The task orchestrator aggregates per-run `SingleResult` objects into `SubagentDetails`, which the tool renderer uses for collapsed and expanded display.

### Child process boundary

Subprocess execution is intentionally isolated from the parent context:

- the child is launched with `--mode json -p`
- when the parent session is persisted, each subagent run gets `--session <path>` in a subagent session directory; otherwise it falls back to `--no-session`
- child subagents are marked with `PI_SUBAGENT=1` in the environment so extensions can adjust behavior for delegated runs
- resolved agent model and normalized tools are forwarded via `--model` and `--tools`
- the agent prompt is appended through `--append-system-prompt <temp file>`
- the delegated work itself is passed as a single prompt string: `Task: <task>`

Invocation is environment-aware:

- if the current process is running from a real script path, the child reuses `process.execPath` plus that script path
- otherwise, if `process.execPath` is already a dedicated executable rather than `node`/`bun`, it is used directly
- otherwise the runtime falls back to invoking `pi`

This preserves local-dev behavior when the extension is being run from a repo checkout rather than an installed global binary.

### Mode orchestration

There is one orchestration shape: a required `tasks` array where each task includes `agent`, `description`, `task`, and `cwd`.

The runtime accepts up to 8 tasks and runs them through `mapWithConcurrencyLimit(...)` with a concurrency cap of 4.

Behavioral details:

- placeholder `SingleResult` entries are created up front with `exitCode: -1` and `agentSource: "unknown"` to support streaming UI updates
- per-task updates replace the placeholder at that task's stable index, so result ordering matches input ordering rather than completion order
- the same path handles single-item and multi-item arrays
- the final tool response is a summary text such as `Parallel: 3/4 succeeded`
- individual task failures remain encoded inside `details.results`; partial failure does **not** currently cause the overall tool call to set `isError`

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

`description` is required for every task item (`tasks[].description`).

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

For `tool_result_end`, the message is appended to the run log and an update is emitted, but rendering later focuses on assistant text/tool-call parts rather than raw tool-result bodies.

### Rendering pipeline

The subagent tool owns both call rendering and result rendering.

- `renderCall(...)` prints a compact preview of the requested task list.
- `renderResult(...)` consumes `SubagentDetails` and renders per-task status/output for running and completed workloads.
- Shared usage strings come from `formatUsageStats(...)`, which delegates token/cost/model formatting to `pi-extensions/extensions/current-context-footer/usage-format.ts`.
- Tool-call summaries come from `formatToolCall(...)`, which special-cases built-ins like `bash`, `read`, `write`, `edit`, `find`, and `grep`.

Expanded views use `Container`, `Text`, `Spacer`, and `Markdown` components to show task text, tool-call summaries, markdown-rendered final output, and usage stats. Collapsed views show shorter previews and prompt the user to expand when content was truncated.

## 3. Data Model

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
	tasks: Type.Array(TaskItem),
});

const TaskItem = Type.Object({
	agent: Type.String(),
	description: Type.String(),
	task: Type.String(),
	cwd: Type.String(),
});
```

Operational constants:

```ts
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
const RUNNING_EXIT_CODE = -1;
```

Notable conventions:

- `agentSource: "unknown"` is used for unknown-agent failures and for in-flight parallel placeholders before discovery metadata is available.
- `exitCode: -1` is reserved for parallel placeholder entries that are still running.
- `thinkingLevel` is derived from `agent.model?.split(":").at(1)` before the subprocess runs; resolved provider/model values may later replace runtime display metadata.

## 4. Interfaces

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

The tool requires a non-empty `tasks` array. Each task must include `agent`, `description`, `task`, and `cwd`.

Invalid payloads (for example, empty arrays) return a text error listing available agents.

#### Agent discovery

At execution start, the tool resolves:

```ts
const discovery = discoverAgents(ctx.cwd);
const agents = discovery.agents;
```

The runtime does not re-normalize tools or models. It assumes discovery already returned executable `AgentConfig` values.

#### Result contract

Guardrail:

- more than 8 tasks returns a text error and empty details

Execution:

- tasks run with max concurrency 4
- streaming updates report `Parallel: <done>/<total> done, <running> running...`
- final content summarizes each task with a 100-character preview of final assistant output

Failure model:

- individual tasks can fail without aborting siblings
- partial failure is summarized in text/details but does not set top-level `isError`

### Internal execution helper: `runSingleAgent(...)`

`runSingleAgent(...)` is the orchestration core. Its contract is:

- if the requested agent name does not exist, return a failed `SingleResult` immediately without spawning a process
- otherwise spawn one child Pi process for the run
- honor the per-run `cwd` supplied in each task item
- when parent session info is available, create a subagent session path and run with `--session`; otherwise run with `--no-session`
- on completion, update `manifest.json` with usage/cost/timing metadata for persisted subagent runs
- if an abort signal fires, send `SIGTERM` immediately and schedule a later `SIGKILL` attempt
- clean up temporary prompt files/directories in a `finally` block regardless of outcome

## 5. Design Decisions

- **Decision:** Subagents run in separate `pi` subprocesses instead of nested in-process calls.
  - **Rationale:** This gives each delegated task an isolated context window and cleanly separates message streams from the parent conversation.

- **Decision:** Runtime discovery happens once per tool invocation before task execution.
  - **Rationale:** All task items use the same effective agent catalog and project-agent directory metadata; one snapshot keeps execution consistent during the run.

- **Decision:** Child Pi invocations always use JSON mode.
  - **Rationale:** The runtime depends on structured `message_end` and `tool_result_end` events for streaming updates, usage aggregation, and renderer-friendly result logs.

- **Decision:** Agent prompts are passed through temporary files with mode `0600`.
  - **Rationale:** `--append-system-prompt` expects a file path, and private temp files avoid embedding long prompts directly in process arguments.

- **Decision:** Persist subagent sessions only when the parent session is persisted, and index them via a per-parent manifest.
  - **Rationale:** This preserves legacy ephemeral behavior for non-persisted runs while enabling structured post-run introspection (task summary, model, usage, cost, duration, and session file) whenever a parent session has a durable log.

- **Decision:** Parallel mode is bounded twice: at 8 total tasks and 4 concurrent workers.
  - **Rationale:** This keeps UI output and local process pressure manageable while still supporting fan-out workflows.

- **Decision:** Pi executes against one merged subagent list rather than exposing source scopes in the tool API.
  - **Rationale:** Source distinctions are useful for debugging and confirmation, but they do not need to complicate normal delegation.

- **Decision:** The tool API is unified around one required `tasks[]` shape instead of separate single/parallel modes.
  - **Rationale:** A single invocation pattern removes mode-dispatch ambiguity, eliminates optional top-level fields, and lets the same orchestration path handle both one-task and many-task runs.

- **Decision:** Rendering emphasizes assistant text and summarized tool calls rather than raw tool-result payloads.
  - **Rationale:** The tool aims to present concise operator-facing progress and outcomes, not a verbatim replay of every event object.

## 6. Testing

There are currently no automated tests in this repo for `pi-extensions/extensions/subagent/`.

Current verification is manual and static:

- `debug-agents` exposes the discovery/runtime boundary for inspection.
- The `subagent` tool exercises subprocess spawning, streaming, confirmation, and rendering in real Pi runs.
- Repo-wide `npm run lint`, `npm run typecheck`, and `npm run test` validate static correctness and package-level tests, but do not assert orchestration behavior directly.

## 7. Open Questions

- Should parallel mode set top-level `isError` when any child task fails, or is mixed-success summary output the intended long-term contract?
- Should invalid-parameter and over-capacity responses be marked as tool errors instead of plain text results?
- Should the renderer surface structured tool-result messages directly in expanded views, or is assistant text plus tool-call summaries sufficient?
- Should parallel mode eventually expose richer task labels or grouping metadata for large fan-outs?

## Code Locations

- `pi-extensions/extensions/README.md`
- `pi-extensions/extensions/subagent/`
- `pi-extensions/extensions/subagent/agents.ts` (runtime input boundary only)
- `pi-extensions/extensions/current-context-footer/usage-format.ts` (shared usage-display helpers consumed by subagent rendering)
- `pi-agents/*.md` (bundled agent definitions executed by this runtime)

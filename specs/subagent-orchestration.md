# Subagent Orchestration Specification

**Status:** Implemented
**Last Updated:** 2026-04-06

## 1. Overview

### Purpose

The subagent extension needs a stable runtime for delegating work to isolated Pi subprocesses while preserving enough structure for streaming progress, UI rendering, and post-run inspection. This domain covers the `subagent` tool and the `debug-agents` command in `pi-extensions/extensions/subagent/index.ts`: mode selection, process spawning, incremental event handling, project-agent confirmation, mode-specific aggregation, and result rendering.

### Goals

- Execute delegated work in isolated child `pi` processes instead of the parent conversation context.
- Support three orchestration modes: single agent, bounded parallel fan-out, and sequential chains.
- Stream incremental progress back into the parent tool call while subprocesses are running.
- Preserve enough metadata per agent run to render useful collapsed and expanded TUI views.
- Reuse discovered agent configuration from the discovery layer without reinterpreting prompt, tool, or model metadata at runtime.
- Warn before executing project-local agents when a UI confirmation path is available.

### Non-Goals

- Discovering or normalizing agent definitions. That belongs to `pi-extensions/extensions/subagent/agents.ts` and is specified in `specs/agent-discovery-and-config.md`.
- Scheduling arbitrarily large workloads. Parallel work is intentionally capped and concurrency-limited.
- Retrying failed agents, checkpointing intermediate state, or resuming partial runs.
- Merging multiple agents into a shared in-process context. Isolation is process-based.
- Defining nested delegation semantics beyond simple chain substitution via `{previous}`.
- Providing a security sandbox stronger than "separate process + optional project-agent confirmation".

## 2. Architecture

Subagent orchestration lives in `pi-extensions/extensions/subagent/index.ts` and sits directly on top of the discovery/config layer from `./agents.js`.

### Extension surface

`export default function (pi: ExtensionAPI)` registers two entry points:

1. `debug-agents` command — snapshots discovered agents for each scope and sends a textual report into the conversation.
2. `subagent` tool — validates parameters, resolves agents through discovery, executes the requested mode, and renders results in the Pi TUI.

### Runtime pipeline

A `subagent` execution follows this flow:

1. Resolve `agentScope` from tool parameters, defaulting to `"user"`.
2. Call `discoverAgents(ctx.cwd, agentScope)` once for the run.
3. Validate that exactly one mode is active: single, parallel, or chain.
4. If project agents are in scope, UI is available, confirmation is enabled, and at least one requested agent came from the project source, prompt the user before continuing.
5. Dispatch to one of the mode handlers.
6. Each individual agent run goes through `runSingleAgent(...)`, which:
   - looks up the requested `AgentConfig`
   - builds a child `pi` invocation in JSON mode
   - writes the agent system prompt to a temporary markdown file when non-empty
   - spawns a subprocess in the requested working directory
   - parses newline-delimited JSON events from stdout
   - accumulates messages, usage, provider/model metadata, and stop/error state
   - emits streaming updates through the tool callback
   - cleans up temporary prompt files afterward
7. The mode handler aggregates per-run `SingleResult` objects into `SubagentDetails`, which the tool renderer uses for collapsed and expanded display.

### Child process boundary

Subprocess execution is intentionally isolated from the parent context:

- the child is launched with `--mode json -p --no-session`
- resolved agent model and normalized tools are forwarded via `--model` and `--tools`
- the agent prompt is appended through `--append-system-prompt <temp file>`
- the delegated work itself is passed as a single prompt string: `Task: <task>`

Invocation is environment-aware:

- if the current process is running from a real script path, the child reuses `process.execPath` plus that script path
- otherwise, if `process.execPath` is already a dedicated executable rather than `node`/`bun`, it is used directly
- otherwise the runtime falls back to invoking `pi`

This preserves local-dev behavior when the extension is being run from a repo checkout rather than an installed global binary.

### Mode orchestration

#### Single mode

Single mode forwards one `agent` + `task` pair to `runSingleAgent(...)` and returns either:

- the final assistant text output on success, or
- a tool-level error result when the subprocess exits non-zero or reports `stopReason` of `error`/`aborted`

The optional top-level `cwd` parameter applies only to single mode.

#### Parallel mode

Parallel mode accepts up to 8 tasks and runs them through `mapWithConcurrencyLimit(...)` with a concurrency cap of 4.

Behavioral details:

- placeholder `SingleResult` entries are created up front with `exitCode: -1` and `agentSource: "unknown"` to support streaming UI updates
- per-task updates replace the placeholder at that task's stable index, so result ordering matches input ordering rather than completion order
- the final tool response is a summary text such as `Parallel: 3/4 succeeded`
- individual task failures remain encoded inside `details.results`; partial failure does **not** currently cause the overall tool call to set `isError`

#### Chain mode

Chain mode executes steps sequentially. Before each step, all `{previous}` placeholders in the step task are replaced with the final assistant text from the previous step.

Behavioral details:

- step numbering starts at 1 and is recorded in `SingleResult.step`
- streaming updates for the current step are combined with already-completed prior steps
- the chain stops on the first failed step
- on failure, the tool returns `isError: true` and reports which step/agent stopped the chain
- on success, the final tool content is the last step's final assistant text

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

- `renderCall(...)` prints a compact preview of the chosen mode, scope, and first few tasks/steps.
- `renderResult(...)` consumes `SubagentDetails` and chooses single, chain, or parallel rendering.
- Shared usage strings come from `formatUsageStats(...)`, which delegates token/cost/model formatting to `pi-extensions/extensions/usage-format.ts`.
- Tool-call summaries come from `formatToolCall(...)`, which special-cases built-ins like `bash`, `read`, `write`, `edit`, `find`, and `grep`.

Expanded views use `Container`, `Text`, `Spacer`, and `Markdown` components to show task text, tool-call summaries, markdown-rendered final output, and usage stats. Collapsed views show shorter previews and prompt the user to expand when content was truncated.

## 3. Data Model

Core runtime shapes defined in `pi-extensions/extensions/subagent/index.ts`:

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
	provider?: string;
	model?: string;
	reasoning?: boolean;
	usingSubscription?: boolean;
	thinkingLevel?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}
```

Tool parameter schema:

```ts
const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String()),
	task: Type.Optional(Type.String()),
	tasks: Type.Optional(Type.Array(TaskItem)),
	chain: Type.Optional(Type.Array(ChainItem)),
	agentScope: Type.Optional(StringEnum(["user", "project", "both"] as const)),
	confirmProjectAgents: Type.Optional(Type.Boolean({ default: true })),
	cwd: Type.Optional(Type.String()),
});
```

Operational constants:

```ts
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
```

Notable conventions:

- `agentSource: "unknown"` is used for unknown-agent failures and for in-flight parallel placeholders before discovery metadata is available.
- `exitCode: -1` is reserved for parallel placeholder entries that are still running.
- `thinkingLevel` is derived from `agent.model?.split(":").at(1)` before the subprocess runs; resolved provider/model values may later replace runtime display metadata.

## 4. Interfaces

### `debug-agents` command

`debug-agents` reads discovery results for `user`, `project`, and `both` scopes and formats each into a plain-text report containing:

- scope name
- resolved project agents directory, if any
- each discovered agent's name and source
- file path
- resolved model when present
- normalized tools, or `(default toolset)` when absent

If the parent context is not idle, the report is queued as a follow-up message and an informational UI notification is emitted when UI support exists.

### `subagent` tool execution contract

#### Mode validation

Exactly one of these must be active:

- `agent` + `task`
- non-empty `tasks`
- non-empty `chain`

Otherwise the tool returns a text error listing available agents. Empty arrays do not count as active modes.

#### Agent scope and discovery

At execution start, the tool resolves:

```ts
const agentScope: AgentScope = params.agentScope ?? "user";
const discovery = discoverAgents(ctx.cwd, agentScope);
const agents = discovery.agents;
```

The runtime does not re-normalize tools or models. It assumes discovery already returned executable `AgentConfig` values.

#### Project-agent confirmation

Confirmation is only attempted when all of the following are true:

- `agentScope` is `project` or `both`
- `confirmProjectAgents !== false`
- `ctx.hasUI` is true
- at least one requested agent resolves to `source === "project"`

The confirmation prompt lists agent names and the resolved project agent directory. If the user declines, execution is canceled before any subprocess is spawned.

#### Single mode result contract

Success:

- returns the final assistant text, or `(no output)` when none exists
- stores a single `SingleResult` in `details.results`

Failure:

- sets `isError: true`
- reports `errorMessage`, else stderr, else final assistant text, else `(no output)`

#### Parallel mode result contract

Guardrail:

- more than 8 tasks returns a text error and empty parallel details

Execution:

- tasks run with max concurrency 4
- streaming updates report `Parallel: <done>/<total> done, <running> running...`
- final content summarizes each task with a 100-character preview of final assistant output

Failure model:

- individual tasks can fail without aborting siblings
- partial failure is summarized in text/details but does not set top-level `isError`

#### Chain mode result contract

Execution:

- each step may override `cwd`
- `{previous}` substitution uses the previous step's final assistant text exactly as returned by `getFinalOutput(...)`

Failure model:

- first failure aborts subsequent steps
- tool returns `isError: true` plus `Chain stopped at step <n> (<agent>): <message>`

### Internal execution helper: `runSingleAgent(...)`

`runSingleAgent(...)` is the orchestration core. Its contract is:

- if the requested agent name does not exist, return a failed `SingleResult` immediately without spawning a process
- otherwise spawn one child Pi process for the run
- honor the per-run or per-step `cwd` when supplied; otherwise use the parent tool's `ctx.cwd`
- if an abort signal fires, send `SIGTERM` immediately and schedule a later `SIGKILL` attempt, although the current guard uses `proc.killed` and therefore treats "signal already sent" as the condition rather than definitively confirming the child exited
- clean up temporary prompt files/directories in a `finally` block regardless of outcome

## 5. Design Decisions

- **Decision:** Subagents run in separate `pi` subprocesses instead of nested in-process calls.
  - **Rationale:** This gives each delegated task an isolated context window and cleanly separates message streams from the parent conversation.

- **Decision:** Runtime discovery happens once per tool invocation, before mode dispatch.
  - **Rationale:** All branches need the same agent catalog and project-agent directory metadata; a single snapshot keeps selection and confirmation consistent during the run.

- **Decision:** Child Pi invocations always use JSON mode.
  - **Rationale:** The runtime depends on structured `message_end` and `tool_result_end` events for streaming updates, usage aggregation, and renderer-friendly result logs.

- **Decision:** Agent prompts are passed through temporary files with mode `0600`.
  - **Rationale:** `--append-system-prompt` expects a file path, and private temp files avoid embedding long prompts directly in process arguments.

- **Decision:** Parallel mode is bounded twice: at 8 total tasks and 4 concurrent workers.
  - **Rationale:** This keeps UI output and local process pressure manageable while still supporting fan-out workflows.

- **Decision:** Chain mode fails fast, but parallel mode tolerates mixed success.
  - **Rationale:** Chain steps are causally dependent through `{previous}` output, while parallel tasks are independent enough to return a mixed summary.

- **Decision:** Project-agent confirmation is only enforced in UI contexts and only for actually requested project agents.
  - **Rationale:** The warning is about repo-controlled prompt content, so prompting only matters when a human can approve and when a project-sourced agent would actually execute.

- **Decision:** Rendering emphasizes assistant text and summarized tool calls rather than raw tool-result payloads.
  - **Rationale:** The tool aims to present concise operator-facing progress and outcomes, not a verbatim replay of every event object.

## 6. Testing

There are currently no automated tests in this repo for `pi-extensions/extensions/subagent/index.ts`.

Current verification is manual and static:

- `debug-agents` exposes the discovery/runtime boundary for inspection across scopes.
- The `subagent` tool exercises subprocess spawning, streaming, confirmation, and rendering in real Pi runs.
- Repo-wide `npm run lint` and `npm run typecheck` validate static correctness but do not assert orchestration behavior.

## 7. Open Questions

- Should parallel mode set top-level `isError` when any child task fails, or is mixed-success summary output the intended long-term contract?
- Should invalid-parameter and over-capacity responses be marked as tool errors instead of plain text results?
- Should the renderer surface structured tool-result messages directly in expanded views, or is assistant text plus tool-call summaries sufficient?
- Should chain substitution eventually support structured handoff data rather than plain final-text `{previous}` replacement?

## Code Locations

- `pi-extensions/extensions/subagent/index.ts`
- `pi-extensions/extensions/subagent/agents.ts` (runtime input boundary only)
- `pi-extensions/extensions/usage-format.ts` (shared usage-display helpers consumed by subagent rendering)
- `pi-extensions/agents/*.md` (bundled agent definitions executed by this runtime)

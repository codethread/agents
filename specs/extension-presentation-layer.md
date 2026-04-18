# Extension Presentation Layer Specification

**Status:** Implemented
**Last Updated:** 2026-04-08

## 1. Overview

### Purpose

This package ships a small presentation layer on top of Pi's extension APIs: compact renderers for noisy built-in tools, a session footer that exposes workspace/model status, shared usage-formatting helpers, and a Rose Pine Moon theme that supplies the semantic colors those renderers depend on. This domain changes how package-provided extensions present state in the Pi TUI; it does not replace the underlying tool behavior.

### Goals

- Reduce visual noise from common tool calls without changing execution behavior.
- Keep footer and tool summaries short enough for narrow terminals.
- Share formatting logic for context, cost, and model display across multiple extensions.
- Use semantic theme roles instead of hardcoded colors in renderer code.
- Surface truncation, error, and high-context states clearly.

### Non-Goals

- Reimplementing the actual `bash` or `read` tools.
- Specifying the subagent runtime itself; only shared presentation helpers are covered here.
- Defining Pi's entire theme schema or TUI framework.
- Persisting usage/session metrics outside the active session.

## 2. Design Decisions

- **Decision:** Wrap built-in `bash` and `read` tools instead of replacing execution logic.
  - **Rationale:** The package wants custom rendering, not a forked tool implementation.

- **Decision:** Hide successful `read` output completely.
  - **Rationale:** File contents are often large and already visible to the model; duplicating them in the TUI adds noise.

- **Decision:** Collapse bash output to five lines by default.
  - **Rationale:** Shell output can be noisy; a small preview keeps transcripts scannable while preserving expansion.

- **Decision:** Share usage/model string formatting in one helper module.
  - **Rationale:** Footer and subagent rendering should present context, cost, and model labels consistently.

- **Decision:** Compute footer cost from assistant messages in the active branch.
  - **Rationale:** The footer reflects session-branch usage, not a global account total.

- **Decision:** Use semantic theme roles in code.
  - **Rationale:** Palette changes should be possible without touching renderer logic.

## 3. Architecture

The presentation layer is split across five pieces:

1. **Compact bash renderer**
   - `pi-extensions/extensions/bash-compact/`
2. **Compact read renderer**
   - `pi-extensions/extensions/read-compact/`
3. **Session footer extension**
   - `pi-extensions/extensions/current-context-footer/`
4. **Shared formatting helpers**
   - `pi-extensions/extensions/current-context-footer/usage-format.ts`
5. **Theme token mapping**
   - `pi-extensions/themes/rose-pine.json`

### Compact tool wrappers

Both compact tool extensions wrap Pi built-ins and re-register them under the canonical tool names:

- `bash-compact/` uses `createBashTool(process.cwd())`
- `read-compact/` uses `createReadTool(process.cwd())`

Execution semantics stay with the built-ins. Only `renderCall(...)` and `renderResult(...)` are customized.

### Shared formatting helpers

`current-context-footer/usage-format.ts` exports pure helpers:

- `formatTokens(...)`
- `formatCost(...)`
- `formatContextDisplay(...)`
- `formatModelDisplay(...)`

The file's default export is a no-op extension function so it can live inside the extensions tree without side effects.

### Session footer

`current-context-footer/index.ts` installs a footer on:

- `session_start`
- `session_switch`

The footer subscribes to branch changes through `footerData.onBranchChange(...)` and requests re-rendering when the git branch changes.

### Theme contract

`rose-pine.json` defines:

- raw palette variables under `vars`
- semantic roles under `colors`
- export-friendly background tokens under `export`

Renderer code requests semantic roles like `toolTitle`, `muted`, `warning`, or `error`; it does not embed palette hex values directly.

## 4. Component Behavior

### Bash compact renderer

`bash-compact/` behavior:

- call view renders `$ <command>`
- optional timeout renders as `(timeout: <n>s)`
- partial result renders `Running...`
- empty output renders `(no output)`
- collapsed result shows first 5 lines
- collapsed overflow shows `... <n> more lines (Ctrl+o to expand)`
- expanded result shows all lines
- when built-in bash truncation metadata reports truncation, the renderer shows:
  - a warning line with shown vs total line counts
  - `Full output: <path>` when `details.fullOutputPath` exists
- when expanded and not tool-truncated, the renderer appends `<n> lines` for outputs longer than the collapsed threshold

### Read compact renderer

`read-compact/` behavior:

- call view renders `read <path>`
- successful results render an empty `Container`, hiding file contents in the TUI
- error results remain visible
- `ENOENT` is normalized to `No such path`
- all other error text passes through unchanged

This means the model still receives the underlying `read` tool result, but the human-facing pane stays quiet on success.

### Current-context footer

The footer renders two or three lines.

#### Line 1: workspace line

Built from:

- `ctx.cwd`, shortened to `~` when under the home directory
- current git branch from `footerData.getGitBranch()`
- current session name from `ctx.sessionManager.getSessionName()`

Format:

```text
<cwd> (<branch>) • <sessionName>
```

Omitted parts are skipped when unavailable.

#### Line 2: stats/model line

Left side:

- context usage from `ctx.getContextUsage()` and `ctx.model?.contextWindow`
- total branch cost, summed from assistant messages in `ctx.sessionManager.getBranch()`

Right side:

- model display from `formatModelDisplay(...)`
- provider is shown only when `footerData.getAvailableProviderCount() > 1`
- thinking level comes from `pi.getThinkingLevel()`

Color rules for context usage:

- default: `dim`
- over 70% context: `warning`
- over 90% context: `error`

Layout behavior:

- left side is truncated first if it alone exceeds available width
- otherwise right side is truncated to fit beside the left side with at least 2 spaces of separation

#### Line 3: extension status line

Shown only when `footerData.getExtensionStatuses()` is non-empty.

Behavior:

- statuses are sorted by extension name
- status text is sanitized to a single line by replacing newlines and tabs with spaces
- final combined line is width-truncated

## 5. Data Model

Formatting options exported from `current-context-footer/usage-format.ts`:

```ts
export interface ContextUsageDisplayOptions {
	contextTokens: number | null | undefined;
	contextWindow?: number;
	contextPercent?: number | null;
	autoCompactEnabled?: boolean;
}

export interface ModelDisplayOptions {
	provider?: string;
	model?: string;
	thinkingLevel?: string;
	reasoning?: boolean;
	includeProvider?: boolean;
}
```

Formatting helpers:

```ts
export function formatTokens(count: number): string;
export function formatCost(cost: number, usingSubscription = false, digits = 3): string;
export function formatContextDisplay(options: ContextUsageDisplayOptions): string;
export function formatModelDisplay(options: ModelDisplayOptions): string;
```

Local conventions:

```ts
const COLLAPSED_LINES = 5;
```

```ts
function mapReadError(message: string): string;
function sanitizeStatusText(text: string): string;
function shortenHome(path: string): string;
```

## 6. Interfaces

### `bash` tool override

Registered by `pi-extensions/extensions/bash-compact/`.

Contract:

- tool name remains `bash`
- execution comes from Pi's built-in bash tool
- presentation is customized through `renderCall(...)` and `renderResult(...)`

### `read` tool override

Registered by `pi-extensions/extensions/read-compact/`.

Contract:

- tool name remains `read`
- execution comes from Pi's built-in read tool
- successful result presentation is intentionally hidden
- failures remain visible in the TUI

### Footer lifecycle hooks

Registered by `pi-extensions/extensions/current-context-footer/`:

```ts
pi.on("session_start", (_event, ctx) => installFooter(ctx));
(
	pi as ExtensionAPI & {
		on(event: "session_switch", handler: (_event: unknown, ctx: ExtensionContext) => void): void;
	}
).on("session_switch", (_event, ctx) => installFooter(ctx));
```

`installFooter(ctx)` calls `ctx.ui.setFooter(...)` and returns an object with:

- `dispose`
- `invalidate`
- `render(width)`

### Shared formatting API

Exported from `pi-extensions/extensions/current-context-footer/usage-format.ts` and consumed by:

- `pi-extensions/extensions/current-context-footer/`
- `pi-extensions/extensions/subagent/`

Behavioral contract:

- `formatTokens(...)` emits compact `k` / `M` suffixes
- `formatCost(...)` optionally appends ` (sub)`
- `formatContextDisplay(...)` includes percent and window size when available
- `formatModelDisplay(...)` appends thinking information only for reasoning-capable models

### Theme interface

The package exposes one theme through `package.json#pi.themes`:

- `pi-extensions/themes/rose-pine.json`

Notable semantic roles used directly by this package include:

- `toolTitle`
- `toolOutput`
- `accent`
- `muted`
- `dim`
- `warning`
- `error`
- `success`

## 7. Testing

There are currently no automated tests in this repo specifically covering these presentation-layer extensions or theme.

Current verification is manual plus static:

- `npm run lint`
- `npm run typecheck`
- local Pi runs from repo root for visual inspection

## 8. Open Questions

- Should successful `read` calls ever expose an expanded-mode preview, or is complete suppression the intended long-term contract?
- `formatContextDisplay(...)` supports `autoCompactEnabled`, but the current footer does not use that suffix. Should another presentation surface consume it?
- Should the theme eventually trim unused semantic keys, or are the extras deliberate future-proofing?

## 9. Code Locations

- `pi-extensions/extensions/README.md`
- `pi-extensions/extensions/bash-compact/`
- `pi-extensions/extensions/read-compact/`
- `pi-extensions/extensions/current-context-footer/`
- `pi-extensions/extensions/current-context-footer/usage-format.ts`
- `pi-extensions/themes/rose-pine.json`
- `package.json`

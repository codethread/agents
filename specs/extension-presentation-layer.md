# Extension Presentation Layer Specification

**Status:** Implemented
**Last Updated:** 2026-04-06

## 1. Overview

### Purpose

This package ships a small presentation layer on top of Pi's extension APIs: compact renderers for noisy built-in tools, a session footer that exposes current workspace and model status, shared usage-formatting helpers, and a Rose Pine Moon theme that supplies the semantic colors those renderers depend on. The goal of this domain is not to change tool execution or model behavior, but to control how package-provided extensions present state, progress, and output inside the Pi TUI.

### Goals

- Reduce visual noise from common tool calls without changing their underlying execution behavior.
- Keep footer and tool summaries short enough to fit narrow terminal widths.
- Share formatting logic for context, cost, and model display across multiple extensions.
- Express presentation decisions through semantic theme roles rather than hardcoded colors in each renderer.
- Surface important failure and truncation states clearly in the TUI.

### Non-Goals

- Implementing the actual `bash` or `read` tool behavior. Those remain delegated to Pi's built-in tool factories.
- Owning the full subagent runtime UI. `pi-extensions/extensions/subagent/index.ts` consumes shared helpers, but the orchestration behavior is specified separately in `specs/subagent-orchestration.md`.
- Defining Pi's global theme schema or TUI APIs. This package only provides one concrete theme and several extension-specific renderers.
- Persisting usage or session metrics outside the active Pi session.

## 2. Architecture

The presentation layer is split across four cooperating parts:

1. **Compact tool wrappers**
   - `pi-extensions/extensions/bash-compact.ts`
   - `pi-extensions/extensions/read-compact.ts`

   These files call Pi's built-in `createBashTool(...)` and `createReadTool(...)`, keep the underlying tool implementations intact, and override only `renderCall(...)` / `renderResult(...)` behavior. The package intentionally re-registers those tools under the canonical names `bash` and `read`, so the user sees package-specific rendering while execution still comes from Pi's built-ins.

2. **Shared formatting helpers**
   - `pi-extensions/extensions/usage-format.ts`

   This module exports pure helpers for token, cost, context-window, and model-label formatting. It has a no-op default export so it can live in the extensions directory without performing its own registration side effects.

3. **Session footer extension**
   - `pi-extensions/extensions/current-context-footer.ts`

   This extension installs a footer on `session_start` and `session_switch`. The footer derives display state from the current working directory, git branch, session name, assistant-message usage totals, context-window usage, enabled model metadata, and extension status messages. It uses `usage-format.ts` for stable text formatting, then applies semantic theme colors and width-aware truncation.

4. **Theme token mapping**
   - `pi-extensions/themes/rose-pine.json`

   The theme defines both a raw palette (`vars`) and semantic color roles (`colors`) such as `toolTitle`, `toolOutput`, `muted`, `warning`, `error`, and thinking-level variants. The renderers do not know about hex colors; they only request semantic roles from the active theme.

### Data flow

- Tool execution happens in Pi's built-in tool implementations.
- Tool results are passed into package renderers.
- Renderers extract a compact textual summary, then style it through `theme.fg(...)` and TUI components like `Text` or `Container`.
- The footer derives session state from `ExtensionContext`, formats stable text fragments through `usage-format.ts`, and truncates them to terminal width with `truncateToWidth(...)` / `visibleWidth(...)`.
- The active theme resolves semantic color names to concrete palette values.

### Per-component behavior

#### Bash compact renderer

`bash-compact.ts` emphasizes command preview and readable output summaries:

- call view shows `$ <command>` with optional timeout text
- partial result view shows `Running...`
- successful result view shows up to 5 lines by default
- expanded view shows all lines and appends a line-count summary when useful
- built-in bash truncation metadata is surfaced explicitly, including `fullOutputPath` when present
- empty output renders as `(no output)`

#### Read compact renderer

`read-compact.ts` is intentionally more aggressive:

- call view shows only `read <path>`
- successful results render an empty `Container`, suppressing file contents in the TUI
- error results remain visible
- `ENOENT` is normalized to `No such path`; all other errors pass through

This means the underlying `read` tool still returns file contents to the model, but the human-facing tool-result pane stays quiet unless the call fails.

#### Current-context footer

`current-context-footer.ts` renders up to three lines:

1. current working directory, shortened to `~` when inside the home directory, plus git branch and optional session name
2. context/cost stats on the left and current model label on the right
3. optional extension status line when any extension reports status text

The footer subscribes to branch changes through `footerData.onBranchChange(...)` and requests re-rendering when branch state changes.

## 3. Data Model

This domain is mostly derived display state rather than persistent entities. The concrete exported formatting types live in `pi-extensions/extensions/usage-format.ts`:

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

Shared formatting helpers:

```ts
export function formatTokens(count: number): string;
export function formatCost(cost: number, usingSubscription = false, digits = 3): string;
export function formatContextDisplay(options: ContextUsageDisplayOptions): string;
export function formatModelDisplay(options: ModelDisplayOptions): string;
```

Local presentation constants and conventions:

```ts
const COLLAPSED_LINES = 5;
```

```ts
function mapReadError(message: string): string;
function sanitizeStatusText(text: string): string;
function shortenHome(path: string): string;
```

Theme file shape:

```json
{
	"name": "rose-pine-moon",
	"vars": { "...": "raw palette values" },
	"colors": { "...": "semantic roles consumed by renderers" },
	"export": { "pageBg": "...", "cardBg": "...", "infoBg": "..." }
}
```

Notable semantic color roles used directly by this package include:

- `toolTitle`
- `toolOutput`
- `accent`
- `muted`
- `dim`
- `warning`
- `error`

The theme also defines additional roles used elsewhere in Pi or reserved for future package renderers, including markdown, syntax-highlighting, diff, and thinking-level colors.

## 4. Interfaces

### `bash` tool override

Registered in `pi-extensions/extensions/bash-compact.ts`:

- wraps `createBashTool(process.cwd())`
- exports under the canonical tool name `bash`
- overrides:
  - `renderCall(args, theme)`
  - `renderResult(result, { expanded, isPartial }, theme)`

Execution semantics come from the built-in bash tool; only UI presentation changes.

### `read` tool override

Registered in `pi-extensions/extensions/read-compact.ts`:

- wraps `createReadTool(process.cwd())`
- exports under the canonical tool name `read`
- overrides:
  - `renderCall(args, theme)`
  - `renderResult(result, _options, theme, context)`

The interface contract is intentionally asymmetric: success is visually hidden, failure remains visible.

### Footer lifecycle hooks

Registered in `pi-extensions/extensions/current-context-footer.ts`:

```ts
pi.on("session_start", (_event, ctx) => installFooter(ctx));
(pi as ExtensionAPI & {
	on(event: "session_switch", handler: (_event: unknown, ctx: ExtensionContext) => void): void;
}).on("session_switch", (_event, ctx) => installFooter(ctx));
```

`installFooter(ctx)` calls `ctx.ui.setFooter(...)` and returns a footer object implementing:

- `dispose`
- `invalidate`
- `render(width: number): string[]`

### Shared formatting API

Exported from `pi-extensions/extensions/usage-format.ts` and consumed by:

- `pi-extensions/extensions/current-context-footer.ts`
- `pi-extensions/extensions/subagent/index.ts`

Behavioral contract:

- `formatTokens(...)` produces compact `k` / `M` suffixes
- `formatCost(...)` optionally appends ` (sub)` for subscription-backed usage
- `formatContextDisplay(...)` includes percent and context-window details when available
- `formatModelDisplay(...)` adds provider and thinking labels only when the caller indicates they should be shown

### Theme interface

The package exposes one theme file through `package.json#pi.themes`:

- `pi-extensions/themes/rose-pine.json`

This theme is the semantic styling contract for the compact tool renderers, footer, and any other package components that use the same color names.

## 5. Design Decisions

- **Decision:** Wrap built-in `bash` and `read` tools instead of replacing their execution logic.
  - **Rationale:** The package wants custom rendering, not a forked tool implementation. Using Pi's factories preserves behavior while narrowing the customization surface to TUI presentation.

- **Decision:** Suppress successful `read` output entirely.
  - **Rationale:** File contents are often large and already visible to the model; showing them again in the tool pane creates more transcript noise than value during interactive use.

- **Decision:** Collapse `bash` output to five lines by default.
  - **Rationale:** Shell commands often emit large logs. A short preview keeps the transcript scannable while still allowing expansion and explicit truncation notices.

- **Decision:** Put shared usage/model string formatting in a standalone helper module.
  - **Rationale:** The footer and subagent UI both need the same formatting rules. Centralizing the logic keeps cost/context/model labels consistent across presentation surfaces.

- **Decision:** Compute total displayed cost from assistant messages in the active session branch.
  - **Rationale:** The footer is representing accumulated session usage, not just the current response or a global account total.

- **Decision:** Use semantic theme roles in code and keep concrete palette values in JSON.
  - **Rationale:** This decouples renderer behavior from any one palette and makes future theme swaps or role tweaks possible without touching TypeScript.

- **Decision:** Sanitize extension status text to a single line before rendering.
  - **Rationale:** Footer layout is width-constrained; raw multiline or tab-heavy status strings would break alignment and readability.

## 6. Testing

There are currently no automated tests in this repo covering the presentation-layer extensions or theme.

Current verification is manual and static:

- `npm run lint` and `npm run typecheck` validate the TypeScript extension modules.
- Running `pi` from the repo root exercises the package through `.pi/settings.json`.
- Visual verification in the Pi TUI is the primary way to confirm collapsed/expanded tool rendering, footer alignment, color choices, and extension status display.

Because this domain is heavily presentation-oriented, behavior is validated mostly through runtime inspection rather than unit tests.

## 7. Open Questions

- Should successful `read` calls optionally expose a tiny preview in expanded mode, or is complete suppression the intended long-term contract?
- `formatContextDisplay(...)` supports `autoCompactEnabled`, but the current footer does not surface that state. Should another extension start using that suffix, or is the option premature?
- The Rose Pine theme defines more semantic keys than these extensions currently consume. Are those extra mappings deliberate future-proofing, or should the package eventually trim unused roles?

## Code Locations

- `pi-extensions/extensions/bash-compact.ts`
- `pi-extensions/extensions/read-compact.ts`
- `pi-extensions/extensions/current-context-footer.ts`
- `pi-extensions/extensions/usage-format.ts`
- `pi-extensions/themes/rose-pine.json`
- `package.json` (theme/extension package exposure)

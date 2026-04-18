# Dynamic Agents Template Injection Specification

**Status:** Implemented
**Last Updated:** 2026-04-17

## 1. Overview

### Purpose

The `dynamic-agents-md` extension appends dynamically rendered prompt text to Pi's system prompt at run start. It supports a global template, a nearest project template, lightweight Nunjucks rendering, and two prompt-debug surfaces so the effective prompt can be inspected without manually reconstructing extension output.

### Goals

- Discover prompt templates from stable global and project locations.
- Render templates with runtime model/provider metadata, agent-role booleans, active tool names, plus environment variables.
- Support both global and project rules in the same prompt when both exist.
- Strip blank lines so rendered prompt fragments stay compact.
- Provide a CLI flag and a command for debugging the effective system prompt.

### Non-Goals

- Supporting arbitrary template filenames or multiple project templates per directory level.
- Persisting rendered prompt output between turns or sessions.
- Mutating user messages instead of the system prompt.
- Sandboxing Nunjucks beyond the extension's small helper surface.
- Cleaning up or managing project template files; the extension only reads them.

## 2. Architecture

Implementation is split across:

- `pi-extensions/extensions/dynamic-agents-md/`
- `pi-extensions/extensions/dynamic-agents-md/parser.ts`

### Template discovery model

The extension understands two template locations:

- **global template**: `agent.njk` under `getPiCodingAgentDir()`
- **project template**: nearest ancestor `.pi/agent.njk` starting from `ctx.cwd`

`getPiCodingAgentDir()` resolves to:

- `process.env.PI_CODING_AGENT_DIR`, when set
- otherwise `~/.pi/agent`

Discovery behavior:

1. check global template with `findGlobalTemplate()`
2. walk upward from the active cwd with `findNearestProjectTemplate()`
3. when both exist, render both
4. when only one exists, render just that one
5. when rendered output becomes empty after blank-line stripping, drop that section

### Rendering model

Rendering uses a shared Nunjucks environment in `parser.ts`.

Input vars passed from `before_agent_start` are normally:

```ts
{
	provider: ctx.model?.provider,
	model: ctx.model?.id,
	cwd: ctx.cwd,
	hasUI: ctx.hasUI,
	isMainAgent: process.env.PI_SUBAGENT?.trim() !== "1",
	isSubagent: process.env.PI_SUBAGENT?.trim() === "1",
	...process.env,
	tools: pi.getActiveTools(),
}
```

When `--debug-prompt` is invoked with a JSON object string, those key/value pairs are merged last and therefore override the machine-derived vars for debug rendering only.

Agent-role behavior:

- top-level Pi runs expose `isMainAgent: true` and `isSubagent: false`
- delegated subagent runs expose `isMainAgent: false` and `isSubagent: true`
- this is derived from the `PI_SUBAGENT=1` environment marker set by the subagent runtime

This lets templates switch between user-facing guidance for the main agent and terse parent-agent-facing guidance for subagents.

Key rendering helpers:

- `renderTemplate(source, vars)` renders raw Nunjucks source
- `stripEmptyLines(text)` trims trailing whitespace, removes blank lines, and trims surrounding whitespace
- `renderTemplateSections(startCwd, vars)` renders zero, one, or two sections
- `renderNearestTemplate(startCwd, vars)` collapses sections into the final injected fragment

When both global and project templates render non-empty output, the final injected fragment is:

```md
# Global rules

<global rendered text>

# Project rules

<project rendered text>
```

When only one template renders non-empty output, the extension injects just that rendered text with no heading wrapper.

### Nunjucks helpers

`parser.ts` adds two custom filters plus one matching global helper:

```ts
regex_test(value, pattern);
has_tools(value, toolOrTools);
has_tools(toolOrTools);
```

Behavior:

- `regex_test(...)`
  - returns `false` unless `value` is a string
  - expands `~` or `~/...` inside the regex pattern via `expandHomePrefix(...)`
  - runs `new RegExp(expandedPattern).test(value)`
- `has_tools(...)`
  - accepts either a single tool name string or an array of tool name strings
  - lowercases and trims tool names before comparison
  - returns `true` only when **all** requested tool names are present in the current `tools` template var
  - returns `false` for invalid or empty input

Typical usage:

```jinja
{% if has_tools(["read", "write"]) %}
Use direct file writes when appropriate.
{% endif %}

{% if tools | has_tools(["read", "edit", "write"]) %}
Prefer exact in-place edits over shell-based rewrites.
{% endif %}
```

These helpers make repo-, path-, and tool-sensitive template rules easy to express.

### Prompt injection lifecycle

The extension registers `before_agent_start` and, when a rendered template exists, returns:

```ts
{
	systemPrompt: `${event.systemPrompt}\n\n${rendered.renderedPrompt}`,
}
```

Important runtime behavior:

- injection happens per agent start, using the current cwd/model metadata
- the extension appends to the existing system prompt rather than replacing it
- no prompt text is injected when no template exists or when rendered output is empty after stripping

### Debug surfaces

#### `--debug-prompt` flag

The extension registers a CLI flag named `debug-prompt`.

Accepted forms:

```bash
pi --debug-prompt
pi --debug-prompt '{"model":"claude-sonnet"}'
pi --debug-prompt='{"model":"claude-sonnet"}'
```

Behavior:

- bare `--debug-prompt` keeps the normal runtime template vars
- when a JSON object string is provided, its keys override the normal template vars for the debug turn only
- values that do not look like a JSON object (do not start with `{`) are ignored so legacy bare-flag invocations like `pi --debug-prompt ping` still behave like plain debug mode
- invalid object-shaped JSON causes the process to print an error and exit `1`

Flow:

1. on `session_start`, if the flag is enabled, parse any optional JSON override from `process.argv`
2. set an internal one-shot latch
3. send a synthetic `ping` user message once so a turn starts and the fully materialized prompt exists
4. show a UI notification describing debug-prompt mode
5. during `before_agent_start`, render templates with the normal vars plus any debug-only overrides
6. on the next `agent_start`, print `ctx.getSystemPrompt()` after `stripEmptyLines(...)` to stdout
7. exit the process with code `0`

This debug path is for non-interactive inspection and intentionally terminates the session process after printing.

#### `/debug-prompt` command

The extension also registers a command named `debug-prompt`.

Behavior:

- reads the current effective system prompt from `ctx.getSystemPrompt()`
- strips empty lines
- requires `$VISUAL` or `$EDITOR`
- writes the prompt to a temp markdown file
- opens that file via `spawnSync(..., { shell: true, stdio: "inherit" })`
- surfaces success/failure through UI notifications

Current implementation detail worth preserving in spec:

- the command creates a temp directory/file for inspection, but does **not** currently remove it after the editor exits

## 3. Data Model

Parser-local types from `parser.ts`:

```ts
export type TemplateMatch = {
	filePath: string;
	scope: "global" | "project";
};

export type RenderedTemplateSection = {
	scope: "global" | "project";
	heading: string;
	filePath: string;
	renderedPrompt: string;
};

export type DynamicAgentsTemplateVars = Record<string, unknown>;
```

Location constants:

```ts
export const LOCAL_TEMPLATE_FILE = ".pi/agent.njk";
export const GLOBAL_TEMPLATE_FILE = "agent.njk";
```

Internal extension state in `index.ts`:

```ts
let printPromptOnNextTurn = false;
let debugPromptTriggered = false;
let debugPromptOverrides: DynamicAgentsTemplateVars | null = null;
```

These fields prevent repeated synthetic `ping` injection for `--debug-prompt`, ensure prompt printing happens exactly once, and carry any debug-only template var overrides into the render step.

## 4. Interfaces

### Parser helpers

#### `findNearestProjectTemplate(startCwd): Promise<TemplateMatch | null>`

- walks upward from `startCwd`
- returns the nearest `.pi/agent.njk`
- returns `null` when none exists

#### `findGlobalTemplate(): Promise<TemplateMatch | null>`

- checks `<PI_CODING_AGENT_DIR>/agent.njk`
- returns `null` when missing

#### `renderTemplateSections(startCwd, vars): Promise<RenderedTemplateSection[]>`

- renders global first, then project
- filters out sections that become empty after stripping
- returns an empty array when nothing remains

#### `renderNearestTemplate(startCwd, vars)`

Return contract:

- `null` when no non-empty section exists
- `{ filePath, renderedPrompt }` for a single rendered section
- `{ filePath, renderedPrompt }` for merged global+project output, with `filePath` set to the last section's file path (project when present)

### Extension API surface

Registered by the `pi-extensions/extensions/dynamic-agents-md/` extension:

- flag: `--debug-prompt` (bare or with a JSON object string)
- command: `/debug-prompt`
- lifecycle hooks:
  - `session_start`
  - `agent_start`
  - `before_agent_start`

No tools are registered.

## 5. Design Decisions

- **Decision:** Support both a global template and a nearest project template.
  - **Rationale:** Personal rules and repo-local rules solve different problems and often need to compose.

- **Decision:** Inject into the system prompt, not as a user message.
  - **Rationale:** These rules are intended to behave like top-level operating instructions for the agent run.

- **Decision:** Strip blank lines aggressively after rendering.
  - **Rationale:** Templates often contain conditional whitespace; stripping keeps injected prompts compact and predictable.

- **Decision:** Add a small `regex_test` Nunjucks filter instead of custom path-matching syntax.
  - **Rationale:** Templates stay flexible without creating a new mini language.

- **Decision:** Use a one-shot synthetic `ping` for `--debug-prompt`.
  - **Rationale:** The effective prompt only exists once a turn is about to start; the debug flag forces that state to materialize.

## 6. Testing

Automated tests exist in:

- `pi-extensions/extensions/dynamic-agents-md/parser.test.ts`
- `pi-extensions/extensions/dynamic-agents-md/index.test.ts`

Covered behaviors include:

- nearest project template discovery
- global template discovery via `PI_CODING_AGENT_DIR`
- local-over-global preference for nearest-template lookup
- `regex_test` behavior, including `~/...` expansion
- `has_tools` behavior for single-tool and multi-tool checks
- `has_tools` false result when any required tool is missing
- main-agent vs subagent template vars derived from `PI_SUBAGENT`
- blank-line stripping
- global+project merge ordering and headings
- null return when rendered output is empty
- `--debug-prompt` override parsing from both `--flag value` and `--flag=value`
- ignoring non-JSON-looking trailing values to preserve legacy bare-flag behavior
- rejection of invalid object-shaped JSON override payloads
- debug-only override precedence over machine-derived template vars

Full extension lifecycle behavior in `index.ts` still has some manual verification coverage.

## 7. Open Questions

- Should `/debug-prompt` clean up its temp file after the editor exits, or is persistence useful for debugging?
- Should template rendering eventually expose additional structured vars beyond provider/model/cwd/hasUI/isMainAgent/isSubagent/tools/env?
- Should system-prompt injection remain the long-term strategy despite prompt-cache tradeoffs noted in `specs/discovery.md`?

## Code Locations

- `pi-extensions/extensions/README.md`
- `pi-extensions/extensions/dynamic-agents-md/`
- `pi-extensions/extensions/dynamic-agents-md/parser.ts`
- `pi-extensions/extensions/dynamic-agents-md/parser.test.ts`

# System Prompt Ownership Specification

**Status:** Implemented in `pi-extensions/extensions/owned-system-prompt/` (discovery notes retained below)
**Last Updated:** 2026-04-18

## 1. Overview

### Purpose

We want a new extension that **owns Pi's base system prompt** while still letting later extensions continue to append or replace prompt text through the normal `before_agent_start` chain.

Concretely:

- the new extension should run **before** the existing prompt-mutating extensions in this package
- it should replace the built-in base prompt with our own scaffold
- later extensions like `dynamic-agents-md` and `subagent` should continue to work unchanged and should see the owned prompt as their input prompt

This spec captures the discovery work, actual Pi experiments, and the implementation direction that was later applied in `pi-extensions/extensions/owned-system-prompt/`.

### Goals

- Confirm how `before_agent_start` ordering behaves in a real Pi runtime.
- Confirm what tool prompt metadata is and is not visible to extension code.
- Confirm whether package manifest ordering can be used to force an extension to run first.
- Identify a practical strategy for owning the prompt without forking Pi internals.
- Leave behind small reusable probe extensions/fixtures for future sessions.

### Non-Goals

- Solving every custom-tool metadata problem in core Pi.
- Replacing Pi's prompt builder inside Pi itself.
- Making this document the sole source of truth after implementation; code and extension README now capture runtime reality.

## 2. Discovery Fixtures

This session added reusable probes under:

- `specs/fixtures/system-prompt-ownership/`

Key fixtures:

- `markers/a.ts`, `markers/b.ts`, `markers/c.ts`
  - append visible prompt markers in `before_agent_start`
- `replace-base.ts`
  - replaces the prompt entirely with `[OWNED-BASE]`
- `package-order/`
  - package-manifest fixture proving explicit `pi.extensions` ordering
- `package-mixed/`
  - package-manifest fixture proving a file can be loaded before a directory of other extensions
- `tool-introspection.ts`
  - registers a custom probe tool and prints actual tool metadata visibility from `pi.getAllTools()`
- `runtime-paths.ts`
  - prints runtime package path probes using `import.meta.resolve(...)`

These are discovery aids only; they are not intended to ship as loadable package extensions.

## 3. Findings From Real Pi Runs

All findings below were verified against a real `pi` process in this repo, not just by reading source.

### 3.1 `before_agent_start` order is extension load order

Observed with explicit CLI ordering:

```bash
pi -p ping \
  --no-session --no-context-files --no-skills --no-prompt-templates --no-themes --no-extensions \
  -e ./pi-extensions/extensions/dynamic-agents-md/index.ts \
  -e ./specs/fixtures/system-prompt-ownership/markers/a.ts \
  -e ./specs/fixtures/system-prompt-ownership/markers/b.ts \
  --debug-prompt
```

Tail of printed prompt:

```text
[MARKER:A]
[MARKER:B]
```

Reversing the `-e` order reversed the marker order.

**Conclusion:** later extensions see the prompt text returned by earlier extensions.

### 3.2 Full replacement really replaces the current prompt for later extensions

Observed with:

```bash
pi -p ping \
  --no-session --no-context-files --no-skills --no-prompt-templates --no-themes --no-extensions \
  -e ./pi-extensions/extensions/dynamic-agents-md/index.ts \
  -e ./specs/fixtures/system-prompt-ownership/replace-base.ts \
  -e ./specs/fixtures/system-prompt-ownership/markers/a.ts \
  --debug-prompt
```

Printed prompt:

```text
[OWNED-BASE]
[MARKER:A]
```

Swapping the order so `replace-base.ts` loaded **after** `markers/a.ts` produced only:

```text
[OWNED-BASE]
```

**Conclusion:** a later replacement clobbers earlier prompt mutations; therefore the ownership extension must load first if later extensions are expected to extend it.

### 3.3 Package manifest ordering is usable and reliable for this purpose

Observed with `specs/fixtures/system-prompt-ownership/package-order/package.json`:

```json
{
	"pi": {
		"extensions": ["./b.ts", "./a.ts", "./c.ts"]
	}
}
```

Running that package fixture yielded:

```text
[PACKAGE:B]
[PACKAGE:A]
[PACKAGE:C]
```

Observed with `specs/fixtures/system-prompt-ownership/package-mixed/package.json`:

```json
{
	"pi": {
		"extensions": ["./a.ts", "./others"]
	}
}
```

Printed prompt tail:

```text
[MIXED:A]
[MIXED:B]
[MIXED:C]
```

**Conclusion:** we can make the future ownership extension run first by listing it explicitly before the shared extensions directory in this package's `package.json#pi.extensions`.

### 3.4 `pi.getAllTools()` does **not** expose `promptSnippet` / `promptGuidelines`

Real runtime probe output from `tool-introspection.ts` showed:

For built-in `read` from `pi.getAllTools()`:

```json
{
	"keys": ["description", "name", "parameters", "sourceInfo"],
	"hasPromptSnippetProp": false,
	"hasPromptGuidelinesProp": false
}
```

For custom `probe_tool` from `pi.getAllTools()`:

```json
{
	"keys": ["description", "name", "parameters", "sourceInfo"],
	"hasPromptSnippetProp": false,
	"hasPromptGuidelinesProp": false
}
```

At the same time, the publicly exported built-in definitions did contain those fields. Example from the same probe for `readToolDefinition`:

```json
{
	"hasPromptSnippetProp": true,
	"promptSnippet": "Read file contents",
	"hasPromptGuidelinesProp": true,
	"promptGuidelines": ["Use read to examine files instead of cat or sed."]
}
```

**Conclusion:**

- built-in tool prompt metadata is available through the public built-in definition exports
- custom tool prompt metadata is **not** exposed through `pi.getAllTools()`
- the ownership extension cannot reconstruct custom tool snippets/guidelines from public tool info alone

### 3.5 Pi core still uses hidden custom-tool prompt metadata internally

The same `tool-introspection.ts` probe registers a custom tool:

- `promptSnippet: "Probe prompt metadata visibility for custom tools"`
- `promptGuidelines: ["Use probe_tool only when debugging which tool prompt metadata Pi exposes to extensions."]`

When we printed the real system prompt via `--debug-prompt`, the built-in prompt included:

```text
- probe_tool: Probe prompt metadata visibility for custom tools
```

and:

```text
- Use probe_tool only when debugging which tool prompt metadata Pi exposes to extensions.
```

**Conclusion:** Pi core has access to custom-tool prompt metadata when it builds the prompt, but extension authors do not currently get that metadata back through the public API.

### 3.6 Asking the model about its prompt is useful only as a loose sanity check

A live prompt asking the model to quote the `probe_tool` line did mention the tool and its guideline, but the wording was not exact.

**Conclusion:** use agent answers only as a coarse sanity check; use `--debug-prompt` as the source of truth.

### 3.7 Runtime package path is available from inside extensions

`runtime-paths.ts` successfully resolved the actual Pi runtime package entry with:

```ts
const packageEntryUrl = import.meta.resolve("@mariozechner/pi-coding-agent");
```

In this environment it resolved to the global Pi install path, not the repo-local dependency path. Also, this shell has:

```bash
PI_PACKAGE_DIR=~/.pi/pi-source
```

which matches the docs/examples paths shown in Pi's built-in prompt.

**Conclusion:** the future ownership extension can derive Pi docs/examples paths without private imports by preferring:

1. `process.env.PI_PACKAGE_DIR` when present
2. otherwise the package root inferred from `import.meta.resolve("@mariozechner/pi-coding-agent")`

### 3.8 Explicit `-e <dir>` without a manifest/index was not enough in this runtime

Trying to load `-e ./specs/fixtures/system-prompt-ownership/markers` failed with:

```text
Failed to load extension ".../markers": Cannot find module '.../markers'
```

Even though Pi docs describe directory discovery, this specific explicit CLI path did not auto-discover loose files in the directory on the tested runtime.

**Conclusion:** for reproducible experiments and for the later production change, prefer:

- explicit extension files, or
- package directories with `package.json#pi.extensions`

## 4. Implications For The Future Ownership Extension

### 4.1 Base prompt ownership strategy

The future implementation should use Pi's supported custom-prompt file rather than trying to replace Pi's built-in prompt at runtime.

Important path note:

- the global file is `~/.pi/agent/SYSTEM.md`
- **not** `~/.pi/agents/SYSTEM.md`

Recommended contents for that file on install:

```md
You are an expert coding assistant operating inside pi, a coding agent harness.
```

Rationale:

- Pi core will then treat this as the custom base prompt
- Pi core will still append project context files, skills, current date, and current working directory when building the effective prompt
- the ownership extension can append the rest of the owned prompt in `before_agent_start`
- this avoids replacing an already-mutated prompt and reduces risk from prompt-section parsing failures

### 4.2 What Pi core still handles for us

From Pi source, when `customPrompt` is present, `buildSystemPrompt(...)` still appends:

- project/global context files (`AGENTS.md` / `CLAUDE.md`) when enabled
- skills, **but only when the `read` tool is active**
- current date
- current working directory

Implication for the future implementation:

- do **not** use `--no-context-files` or `--no-skills`
- keep `read` active if we want Pi core to continue surfacing skills in the prompt
- v1 should rely on core behavior first and only add custom handling if testing proves something is missing

### 4.3 Tool metadata strategy

Because custom tool `promptSnippet` / `promptGuidelines` are not exposed publicly, the future extension should not attempt to reconstruct those dynamically in v1.

Instead, v1 should:

- manually vendor the built-in tool prompt metadata we care about
- append those owned tool sections/guidelines to the prompt in a deterministic format
- tolerate later sections from other extensions appearing before or after owned sections

This is acceptable because:

- built-in tool metadata is accessible from the public built-in tool definition exports and source files
- built-in tool strings are unlikely to change often
- manual sync on Pi upgrades is cheap

### 4.4 How to keep built-in tool metadata in sync

When refreshing built-in tool snippets/guidelines, inspect the built-in tool definitions under Pi's package dir.

Documentation should refer to package-relative locations, not machine-specific absolute paths.

Recommended reference locations:

- `$PI_PACKAGE_DIR/dist/core/tools/read.js`
- `$PI_PACKAGE_DIR/dist/core/tools/bash.js`
- `$PI_PACKAGE_DIR/dist/core/tools/edit.js`
- `$PI_PACKAGE_DIR/dist/core/tools/write.js`
- `$PI_PACKAGE_DIR/dist/core/tools/grep.js`
- `$PI_PACKAGE_DIR/dist/core/tools/find.js`
- `$PI_PACKAGE_DIR/dist/core/tools/ls.js`

If `PI_PACKAGE_DIR` is not set, the implementation may fall back to package resolution via:

```ts
import.meta.resolve("@mariozechner/pi-coding-agent");
```

but the spec and README should avoid machine-local install paths such as Nix store paths.

### 4.5 Pi-docs guidance ownership

The current built-in prompt contains guidance about how to inspect Pi itself.

Implemented ownership change:

- moved that explanatory Pi-specific guidance into `pi-extensions/extensions/pi-discovery/README.md`
- `pi-discovery` now owns the user-facing note about how Pi source/extensions should be inspected
- `pi-discovery` now surfaces Pi package/source paths alongside discovered extension paths, reducing the need for the owned system prompt to carry that longer Pi-documentation block in v1

This intentionally moves some Pi-specific guidance from system prompt space to a conditional user-message path, which is acceptable for now.

### 4.6 Load ordering strategy

The future production extension should still be loaded first where practical.

Recommended package manifest change in the future build session:

```json
{
	"pi": {
		"extensions": ["./pi-extensions/extensions/owned-system-prompt", "./pi-extensions/extensions"]
	}
}
```

Rationale:

- the explicitly listed ownership extension runs first
- later extensions still append/override normally
- even though v1 is designed to tolerate some section reordering, loading first gives the cleanest prompt shape

## 5. Recommended v1 Build Direction

For the next implementation session, build the ownership extension around this flow:

1. user creates `~/.pi/agent/SYSTEM.md` containing the single framing line
2. the new extension runs in `before_agent_start`
3. it appends the owned tool section and owned guidelines section using manually synced built-in metadata
4. it does **not** disable core context-file or skill handling
5. later extensions continue chaining as usual
6. a `--debug-*` flag prints the final owned prompt for verification

This gives immediate ownership of the base scaffold while avoiding fragile prompt parsing and avoiding dependence on hidden custom-tool metadata.

## 6. Planned Production Extension Shape

Implemented at:

- `pi-extensions/extensions/owned-system-prompt/`

Minimum surfaces:

- `before_agent_start` hook
- one `--debug-*` CLI flag
- README explaining:
  - user must create `~/.pi/agent/SYSTEM.md` on new machines
  - expected minimal contents of that file
  - where to refresh built-in tool metadata (`$PI_PACKAGE_DIR/dist/core/tools/*.js`)
- tests covering:
  - owned prompt assembly
  - ordering assumptions
  - docs/examples path handling if any remain in prompt output
  - coexistence with context files and skills

## 7. Open Questions

### 7.1 Do we need to own custom-tool prompt snippets/guidelines in v1?

Recommended answer: **no**.

V1 should own the built-in tool framing and leave custom-tool prompt guidance to the extensions that already append later prompt text.

### 7.2 Will context files and skill blocks still be present when `SYSTEM.md` replaces the base prompt?

Recommended answer from source reading: **yes**, provided the relevant features stay enabled, and skills still depend on `read` being active.

This must still be verified in the implementation session with a real Pi run.

### 7.3 Should we later teach custom extensions to publish prompt metadata cooperatively?

Recommended answer: **probably yes**, but only after the ownership extension proves valuable.

The first likely candidate is `subagent`, since its prompt snippet is semantically important.

## 8. Summary

Discovery established the following practical path:

- prompt ownership is feasible today through supported Pi customization points
- the simplest safe approach is to use `~/.pi/agent/SYSTEM.md` for the base framing line and append owned sections from an extension
- package manifest ordering can still help keep the prompt shape clean
- public Pi APIs do **not** expose custom-tool prompt snippet/guideline metadata
- built-in tool metadata can be manually synced from `$PI_PACKAGE_DIR/dist/core/tools/*.js`
- context files, skills, date, and cwd should continue to be handled by Pi core when we do **not** disable them

That is the design this repo should implement in the next session.

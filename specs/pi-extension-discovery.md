# Pi Extension Discovery Specification

**Status:** Implemented
**Last Updated:** 2026-04-18

## 1. Overview

### Purpose

The `pi-discovery` extension tells Pi where both its runtime/source tree and its currently discovered extension source code live, but only when that context is likely relevant. Instead of appending a compact discovery catalog to every system prompt, it watches raw user input and appends a one-shot contextual note to the first user message whose text contains the standalone, case-sensitive token `Pi`. That note gives the agent enough runtime/package and extension-discovery context to inspect installed Pi files directly when users reference Pi behavior, prompt variables, or package-provided runtime features.

### Goals

- Expose the active global/project Pi config paths relevant to extension discovery.
- Expose the preferred Pi package/source root plus key docs/examples/core-tool paths.
- Discover enabled extension entrypoints without loading them a second time.
- Include enough provenance metadata for Pi to find the real source tree for each extension without surfacing redundant path labels.
- Avoid unconditional system-prompt injection for unrelated turns.
- Inject discovery context only when the user explicitly mentions `Pi`.
- Fire at most once per extension runtime instance.
- Provide a lightweight debug command for sending the current catalog into the conversation.

### Non-Goals

- Explaining extension behavior itself. The extension only points Pi at the files so it can inspect them.
- Loading or executing extension modules for discovery.
- Managing extension enable/disable state.
- Discovering skills, prompts, themes, or agents. This extension is still primarily about Pi runtime + extension source discoverability.

## 2. Architecture

Implementation is split across:

- `pi-extensions/extensions/pi-discovery/`
- `pi-extensions/extensions/pi-discovery/context-note.ts`
- `pi-extensions/extensions/pi-discovery/extension-discovery.ts`

### Discovery model

The extension delegates filesystem/package resolution to Pi's own package-resolution layer:

1. `discoverPiExtensions(cwd, agentDir)` creates a `SettingsManager` for the current cwd and user agent dir.
2. It creates a `DefaultPackageManager` with that settings manager.
3. It calls `packageManager.resolve(async () => "skip")` so missing configured packages are skipped instead of being auto-installed.
4. It filters the resolved extension resources down to `enabled === true`.
5. It projects each resolved resource into a compact `PiExtensionRecord` with:
   - inferred extension name
   - entry file path
   - scope
   - normalized provenance source string
   - origin (`package` vs `top-level`)
   - base directory when available

For package-origin resources, local package source strings are normalized to absolute paths using the resolved package base dir. During prompt/debug formatting, `source` is omitted when it would be identical to `baseDir`.

Because discovery uses `DefaultPackageManager.resolve(...)`, it follows Pi's real precedence and filtering behavior for:

- `~/.pi/agent/settings.json`
- `<cwd>/.pi/settings.json`
- auto-discovered `extensions/` directories
- package-provided extensions from `settings.json#packages`
- manifest-based package resource filtering

### Context-note injection lifecycle

The extension caches discovery per cwd for the session runtime and keeps a closure-scoped one-shot flag for whether contextual discovery has already been injected.

- `session_start` kicks off discovery eagerly.
- `input` inspects raw user text before skill/template expansion.
- if the input source is `"extension"`, the hook does nothing.
- if the one-shot flag is already set, the hook does nothing.
- if the raw text does not contain the standalone, case-sensitive token `Pi`, the hook does nothing.
- otherwise the hook awaits the cached discovery result, appends a contextual note to the same user message, and marks the one-shot flag as fired.

The appended contextual note contains:

- a short instruction telling Pi to inspect Pi source/docs and matching extension source files directly when relevant
- global/project config paths relevant to extension discovery
- Pi runtime/source package paths, preferring `PI_PACKAGE_DIR` when available and otherwise falling back to the installed `@mariozechner/pi-coding-agent` package root inferred from `import.meta.resolve(...)`
- existence status for those paths
- one `<extension ... />` entry per enabled extension entrypoint

This keeps unrelated turns lean while still surfacing extension source locations when the user explicitly signals Pi-specific intent.

### Agent-instance semantics

The one-shot guard is in-memory only and is scoped to the extension runtime instance.

Implications:

- it resets on `/reload`
- it resets when Pi creates a fresh extension runtime for `/new`, `/resume`, or `/fork`
- it is not persisted into session state
- a failed discovery lookup should not consume the one-shot trigger

### Debug surface

The extension also registers `/debug-extensions`.

Behavior:

- formats the current discovery state as plain text
- sends it as a user message into the conversation
- if Pi is busy, queues it as a follow-up message

## 3. Data Model

Core types:

```ts
export interface PiExtensionRecord extends SourceInfo {
	name: string;
}

export interface PiSourceDiscovery {
	inspectPackageDir: string;
	inspectPackageDirSource: "env" | "runtime-package";
	runtimePackageDir: string;
	runtimePackageEntry: string;
	docsDir: string;
	examplesDir: string;
	coreToolsDir: string;
}

export interface PiExtensionDiscovery {
	agentDir: string;
	globalSettingsPath: string;
	globalExtensionsDir: string;
	projectConfigDir: string;
	projectSettingsPath: string;
	projectExtensionsDir: string;
	piSource: PiSourceDiscovery;
	extensions: PiExtensionRecord[];
}
```

Derived extension names use this rule:

- `.../foo/index.ts` or `index.js` -> `foo`
- `.../bar.ts` or `bar.js` -> `bar`

## 4. Interfaces

### `discoverPiExtensions(cwd, agentDir?)`

Returns the resolved discovery snapshot for the working directory.

Behavioral contract:

- uses Pi's real package/resource resolution instead of custom ad hoc parsing
- skips missing configured packages instead of installing them
- returns only enabled extension entrypoints
- preserves Pi precedence ordering from `DefaultPackageManager.resolve(...)`

### `formatExtensionDiscoveryContextNote(discovery)`

Returns a contextual-note fragment structured as:

- a short instruction telling Pi to inspect Pi source/docs and extension source files directly when relevant
- `<pi_extension_discovery>` root element
- a single `<paths ... />` element with global/project path metadata
- a single `<pi_source ... />` element with Pi package/runtime path metadata
- `<available_extensions>` containing one self-closing `<extension ... />` element per discovered extension

This fragment is appended to the triggering user message via the `input` transform path rather than the system prompt.

### `/debug-extensions`

Sends a human-readable report into the conversation.

## 5. Design Decisions

- **Decision:** Discovery uses `DefaultPackageManager.resolve(...)` instead of manual parsing.
  - **Rationale:** It exactly matches Pi's real extension/package discovery rules, including package manifests, precedence, and path filters.

- **Decision:** Missing configured packages are skipped during discovery.
  - **Rationale:** This extension is informational; it must not trigger installs as a side effect of prompt rendering.

- **Decision:** The extension uses the `input` event for trigger detection.
  - **Rationale:** `input` sees the raw user text before skill/template expansion, so the extension can detect a literal `Pi` mention and append context to that same user message.

- **Decision:** Discovery is no longer injected into the system prompt on every turn.
  - **Rationale:** This avoids polluting unrelated prompts and reduces unnecessary prompt-cache churn while still surfacing the data when the user signals Pi-specific intent.

- **Decision:** The contextual-note format remains compact XML.
  - **Rationale:** Pi already uses terse XML catalogs elsewhere in this repo, and XML attributes keep path-heavy entries relatively small.

- **Decision:** The extension exposes Pi runtime/package paths and extension file paths/base directories, not behavior summaries.
  - **Rationale:** The user goal is source-code discoverability. Once Pi knows where the core package and enabled extensions live, it can inspect the implementation directly.

- **Decision:** The `Pi` trigger is case-sensitive and single-shot per extension runtime.
  - **Rationale:** This keeps the behavior narrow, predictable, and low-noise. The intent is to catch explicit Pi references, not every lowercase `pi` substring or repeated follow-up turn.

## 6. Testing

Automated tests live in:

- `pi-extensions/extensions/pi-discovery/context-note.test.ts`
- `pi-extensions/extensions/pi-discovery/extension-discovery.test.ts`

Covered behaviors include:

- name inference for `index.ts` vs single-file extensions
- mixed project/user/package discovery ordering
- package-origin metadata preservation
- contextual-note/report formatting, including Pi source path metadata
- trigger detection for standalone `Pi`
- non-matches for lowercase `pi`, embedded substrings such as `pilot`, and extension-originated input
- single-shot runtime behavior
- retry behavior when discovery fails before the one-shot flag is consumed

## Code Locations

- `pi-extensions/extensions/README.md`
- `pi-extensions/extensions/pi-discovery/`
- `pi-extensions/extensions/pi-discovery/context-note.ts`
- `pi-extensions/extensions/pi-discovery/context-note.test.ts`
- `pi-extensions/extensions/pi-discovery/extension-discovery.ts`
- `pi-extensions/extensions/pi-discovery/extension-discovery.test.ts`

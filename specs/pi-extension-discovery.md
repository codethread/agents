# Pi Extension Discovery Specification

**Status:** Implemented
**Last Updated:** 2026-04-10

## 1. Overview

### Purpose

The `pi-discovery` extension tells Pi where its currently discovered extension source code lives. It appends a compact extension catalog to the system prompt so the agent can inspect installed extension files directly when users reference extension behavior, prompt variables, or package-provided runtime features.

### Goals

- Expose the active global/project Pi config paths relevant to extension discovery.
- Discover enabled extension entrypoints without loading them a second time.
- Include enough provenance metadata for Pi to find the real source tree for each extension without surfacing redundant path labels.
- Provide a lightweight debug command for sending the current catalog into the conversation.

### Non-Goals

- Explaining extension behavior itself. The extension only points Pi at the files so it can inspect them.
- Loading or executing extension modules for discovery.
- Managing extension enable/disable state.
- Discovering skills, prompts, themes, or agents. This extension is extension-specific.

## 2. Architecture

Implementation is split across:

- `pi-extensions/extensions/pi-discovery/index.ts`
- `pi-extensions/extensions/pi-discovery/lib.ts`

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

### Prompt injection lifecycle

The extension caches discovery per cwd for the session runtime.

- `session_start` kicks off discovery eagerly.
- `before_agent_start` awaits the cached discovery result and appends a compact XML block to the system prompt.

The prompt block contains:

- global/project config paths relevant to extension discovery
- existence status for those paths
- one `<extension ... />` entry per enabled extension entrypoint

This makes extension source locations available to Pi before each run without requiring a manual debug step.

### Debug surface

The extension also registers `/debug-extensions`.

Behavior:

- formats the current discovery state as plain text
- sends it as a user message into the conversation
- if Pi is busy, queues it as a follow-up message

## 3. Data Model

Core types from `lib.ts`:

```ts
export interface PiExtensionRecord extends SourceInfo {
	name: string;
}

export interface PiExtensionDiscovery {
	agentDir: string;
	globalSettingsPath: string;
	globalExtensionsDir: string;
	projectConfigDir: string;
	projectSettingsPath: string;
	projectExtensionsDir: string;
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

### `formatExtensionDiscoveryForPrompt(discovery)`

Returns a system-prompt fragment structured as:

- a short instruction telling Pi to inspect extension source files directly when relevant
- `<pi_extension_discovery>` root element
- a single `<paths ... />` element with global/project path metadata
- `<available_extensions>` containing one self-closing `<extension ... />` element per discovered extension

### `/debug-extensions`

Sends a human-readable report into the conversation.

## 5. Design Decisions

- **Decision:** Discovery uses `DefaultPackageManager.resolve(...)` instead of manual parsing.
  - **Rationale:** It exactly matches Pi's real extension/package discovery rules, including package manifests, precedence, and path filters.

- **Decision:** Missing configured packages are skipped during discovery.
  - **Rationale:** This extension is informational; it must not trigger installs as a side effect of prompt rendering.

- **Decision:** The prompt format is compact XML.
  - **Rationale:** Pi already uses terse XML catalogs elsewhere in this repo, and XML attributes keep path-heavy entries relatively small.

- **Decision:** The extension exposes file paths and base directories, not behavior summaries.
  - **Rationale:** The user goal is source-code discoverability. Once Pi knows where code lives, it can inspect the implementation directly.

## 6. Testing

Automated tests live in:

- `pi-extensions/extensions/pi-discovery/lib.test.ts`

Covered behaviors include:

- name inference for `index.ts` vs single-file extensions
- mixed project/user/package discovery ordering
- package-origin metadata preservation
- prompt/report formatting

## Code Locations

- `pi-extensions/extensions/README.md`
- `pi-extensions/extensions/pi-discovery/index.ts`
- `pi-extensions/extensions/pi-discovery/lib.ts`
- `pi-extensions/extensions/pi-discovery/lib.test.ts`

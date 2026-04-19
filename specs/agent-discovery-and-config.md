# Agent Discovery and Configuration Specification

**Status:** Implemented
**Last Updated:** 2026-04-17

## 1. Overview

### Purpose

The subagent extension needs a stable way to find agent definitions, normalize them into Pi-ready runtime configuration, and expose enough metadata for both execution and debugging. This domain covers how markdown-backed agent definitions are discovered from package, user, and project locations; how frontmatter fields are parsed into `AgentConfig`; how tool and model metadata are normalized; and how the resulting catalog is handed to the subagent runtime.

### Goals

- Discover agents from bundled package content plus optional user and project directories.
- Return a uniform `AgentConfig` shape regardless of source file location.
- Present Pi with one effective merged list of available subagents.
- Preserve source metadata for debug output and project-agent confirmation.
- Allow direct top-level selection of one discovered agent config via `--agent <name>`.
- Normalize legacy Claude-flavored tool names while treating agent `tools` as an exact allowlist across built-in and extension tools.
- Resolve lightweight model aliases into enabled OpenAI-backed models when local settings make that possible.
- Apply deterministic source precedence so agent name collisions resolve predictably.

### Non-Goals

- Executing agent tasks or managing agent process lifecycle. That belongs to the subagent runtime in `pi-extensions/extensions/subagent/`.
- Validating rich agent schemas beyond the required frontmatter fields. Discovery assumes frontmatter is parseable and that `tools`, when present, behaves like a string.
- Merging multiple definitions of the same agent across sources. Collisions are resolved by replacement, not composition.
- Supporting arbitrary external tool names or provider-agnostic model aliasing. Normalization is intentionally narrow and conservative.
- Exposing user/project/both discovery scopes to Pi-facing runtime selection.

## 2. Design Decisions

- **Decision:** Agents are defined as markdown files with frontmatter and prompt body.
  - **Rationale:** A single file can carry both runtime metadata and the system prompt, while also allowing author-only notes such as `meta`, matching how bundled agents in `pi-agents/*.md` are authored.

- **Decision:** Pi sees one merged agent list rather than choosing among discovery scopes.
  - **Rationale:** Runtime behavior is simpler when user/project/package sources are a discovery concern, not a tool-call concern.

- **Decision:** Direct top-level agent mode reuses the same merged discovery result as delegated subagent runs.
  - **Rationale:** `pi --agent <name>` should honor the same package → user → project override semantics as the `subagent` tool and child runtime.

- **Decision:** Top-level `--agent` inheritance is derived from shared runtime-setting helpers rather than ad hoc field reads in the extension entrypoint.
  - **Rationale:** When new runtime-facing agent fields are added over time, extending the shared helper layer keeps child subagent execution and top-level direct-agent mode aligned.

- **Decision:** Explicit CLI flags override inherited agent fields on a per-field basis.
  - **Rationale:** Users should be able to adopt an agent wholesale and still override just model, thinking, or tools without losing the rest of the agent-defined behavior.

- **Decision:** Source precedence is implemented with a name-keyed `Map`.
  - **Rationale:** Replacement semantics are simple and deterministic, and they let user or project agents override bundled defaults without extra merge rules.

- **Decision:** Source-specific lists are still returned for debugging.
  - **Rationale:** Humans sometimes need to understand where definitions came from even though Pi should not care.

- **Decision:** Discovery is best-effort for filesystem and JSON access, but not for all frontmatter shape errors.
  - **Rationale:** `readJsonFile`, directory reads, and file reads are wrapped defensively, but `parseFrontmatter(...)` and `frontmatter.tools?.split(",")` are not guarded per file. In practice, unreadable files are skipped, while malformed frontmatter or unexpected `tools` types can still abort discovery.

- **Decision:** Agent `tools` is an exact allowlist over the full active tool namespace, not just built-ins.
  - **Rationale:** Built-in and extension tools must obey the same least-privilege contract. If an agent file does not name `subagent`, `questionnaire`, or any other extension tool, direct `--agent` mode and delegated child runs must not quietly keep that tool active.

- **Decision:** Tool normalization is only lossy for unsupported Claude-only aliases.
  - **Rationale:** Known Claude aliases should map to Pi equivalents, unsupported Claude tools such as `task`, `websearch`, `webfetch`, and `skill` should be dropped, and all other tool names should be preserved so extension-defined tools remain configurable from agent frontmatter.

- **Decision:** Claude-family model aliases are rewritten only when local OpenAI-backed models are enabled.
  - **Rationale:** This preserves author intent for portable agent files while still allowing bundled agents authored with Claude-style names like `sonnet` or `haiku` to run in Pi environments backed by OpenAI/OpenAI Codex models.

- **Decision:** Settings lookup is based on the caller's working directory, not the agent file's location.
  - **Rationale:** Discovery behaves like the rest of Pi configuration resolution: the active workspace determines settings for the whole run.

## 3. Architecture

Agent discovery is implemented in `pi-extensions/extensions/subagent/agents.ts` and consumed by the subagent runtime in `pi-extensions/extensions/subagent/`.

### Discovery pipeline

1. `discoverAgents(cwd)` derives three candidate roots:
   - bundled package agents from `findBundledAgentsDir()`
   - user agents from `path.join(getAgentDir(), "agents")`
   - project agents from the nearest ancestor `.pi/agents` directory via `findNearestProjectAgentsDir(cwd)`
2. The same call also resolves settings with `findNearestSettingsFile(cwd)`, preferring the nearest ancestor `.pi/settings.json` and falling back to the user settings file under `getAgentDir()`.
3. Each discovered directory is loaded through `loadAgentsFromDir(dir, source, settings)`.
4. Each markdown file is parsed with `parseFrontmatter(...)`.
5. Required frontmatter fields are projected into `AgentConfig`, while the markdown body becomes `systemPrompt`.
6. `normalizeTools(...)` maps the optional `tools` list into Pi tool names.
7. `resolveModelAlias(...)` optionally rewrites lightweight model aliases using enabled models from settings.
8. A `Map<string, AgentConfig>` applies source precedence by agent name and produces the final effective `agents` array.
9. The same discovery pass also returns raw `userAgents` and `projectAgents` lists for debug output.

### Source locations and precedence

Discovery supports three sources:

- **package** — bundled agents under repo-level `pi-agents/` (with legacy fallback support for `pi-extensions/agents/`)
- **user** — agents under `~/.pi/agent/agents`
- **project** — agents under the nearest ancestor `.pi/agents`

Precedence is name-based and deterministic:

- package agents are inserted first
- user agents overwrite package agents with the same name
- project agents overwrite both package and user agents with the same name

There is no field-by-field merge. The later source replaces the earlier `AgentConfig` for the same `name`.

### Effective vs source-specific views

Discovery returns multiple views from one pass:

- `agents` — the effective merged list Pi actually sees and executes against
- `userAgents` — raw user-defined agents for debug inspection
- `projectAgents` — raw project-local agents for debug inspection
- `projectAgentsDir` — nearest project agent directory, if present

This keeps Pi-facing behavior simple while preserving source visibility for humans.

### Settings and model resolution

Settings are not loaded per source directory. A single nearest settings file is chosen for the current working directory, then applied to every discovered agent during that discovery pass.

Model alias resolution is intentionally opportunistic:

- fully qualified models containing `/` are left unchanged
- blank or missing model values become `undefined`
- if no enabled `openai/` or `openai-codex/` models are configured, aliases are left unchanged
- `haiku`-like aliases prefer a model containing `mini`
- `sonnet`, `opus`, and `claude*` aliases prefer a non-`mini` enabled OpenAI model
- the configured default provider/model is preferred only when it is both fully qualified and present in `enabledModels`

### Runtime integration boundary

The subagent runtime uses discovery results in four places:

- `before_agent_start` discovers agents once and injects a terse XML list of available subagent names and descriptions into the parent agent system prompt.
- when `--agent <name>` is set, the same discovery result resolves the selected agent by name, derives inherited runtime settings from that `AgentConfig`, applies model/thinking/tools unless explicit CLI flags override those fields, and appends the agent's `systemPrompt` wrapped in `<system_reminder type="selected-agent-prompt">` to the parent system prompt.
- `debug-agents` renders the effective agent list plus source-specific user/project sections.
- `subagent` execution always uses the effective merged list, while still consulting `source === "project"` for confirmation behavior.

This means discovery is the configuration boundary; runtime execution trusts the normalized `AgentConfig` it receives.

## 4. Data Model

Core exported types from `pi-extensions/extensions/subagent/agents.ts`:

```ts
export interface AgentConfig {
	name: string;
	description: string;
	tools: string[];
	model?: string;
	systemPrompt: string;
	source: "package" | "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	userAgents: AgentConfig[];
	projectAgents: AgentConfig[];
	projectAgentsDir: string | null;
}
```

Settings shape used during discovery:

```ts
interface PiSettings {
	defaultProvider?: string;
	defaultModel?: string;
	enabledModels?: string[];
}
```

Supported canonical built-in tools and Claude-to-Pi normalization table:

```ts
const PI_CANONICAL_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

const CLAUDE_TOOL_MAP: Record<string, string | null> = {
	read: "read",
	bash: "bash",
	edit: "edit",
	write: "write",
	grep: "grep",
	glob: "find",
	ls: "ls",
	multiedit: "edit",
	notebookedit: "edit",
	task: null,
	websearch: null,
	webfetch: null,
	skill: null,
};
```

Discovery normalizes tool names as follows:

- canonical Pi built-ins stay as-is
- known Claude aliases such as `glob` and `multiedit` map to their Pi equivalents
- unsupported Claude-only tools such as `task`, `websearch`, `webfetch`, and `skill` are dropped
- any other tool name is preserved (lowercased) so extension tools like `subagent` or `questionnaire` remain expressible in agent frontmatter
- omitted or blank `tools` frontmatter resolves to an empty allowlist

Bundled agents in this repo demonstrate the file format discovery expects:

- `pi-agents/scout.md`
- `pi-agents/hack.md`
- `pi-agents/builder.md`

These files use YAML frontmatter for `name`, `description`, optional author-only `meta`, and optional `tools` / `model`, followed by a markdown prompt body that becomes `systemPrompt`.

## 5. Interfaces

### Exported discovery API

#### `discoverAgents(cwd: string): AgentDiscoveryResult`

Returns the resolved agent catalog for a working directory.

Behavioral contract:

- bundled package agents are always considered
- user agents are always considered
- project agents are loaded from the nearest ancestor `.pi/agents`, when present
- `projectAgentsDir` reports the nearest project agent directory even when no project agents are ultimately loaded
- unreadable directories, unreadable files, and invalid JSON settings fail closed by omission rather than throwing
- agent frontmatter is expected to be parseable, and `tools` is expected to be string-like when present; parse/type errors in those paths are not isolated per file by the current implementation

#### `formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number }`

Formats a short human-readable list such as `name (source): description` and reports how many items were omitted.

#### `formatAgentsForPrompt(agents: AgentConfig[]): string`

Formats discovered subagents for system-prompt injection as:

- an outer `<system_reminder type="available-subagents">` wrapper
- a terse lead-in line: `These are the available subagents with their intended use.`
- an inner XML list under `<available_subagents>`
- one `<subagent>` entry per agent containing `<name>` and `<description>` only

#### `findAgentByName(agents: AgentConfig[], name: string | undefined | null): AgentConfig | undefined`

Returns the effective discovered agent whose `name` exactly matches the trimmed requested name.
Returns `undefined` for blank or missing names.

#### `getAgentRuntimeSettings(agent: AgentConfig): AgentRuntimeSettings`

Extracts the runtime-facing settings represented by one discovered agent.
Today that includes:

- `systemPrompt`
- `tools`
- `modelFlagValue` (full CLI-ready model string, including any thinking suffix)
- `modelRef` (provider/model without thinking suffix when parsable)
- `thinkingLevel` (parsed from a recognized `:off|minimal|low|medium|high|xhigh` suffix)

This helper is the shared source of truth for both child subagent execution and top-level `--agent` inheritance.

#### `parseAgentFlagCliOverrides(argv: string[]): AgentFlagCliOverrides`

Detects explicit CLI overrides that should suppress inherited agent fields for direct top-level mode.
Today this treats the following as overrides:

- `--model` / `-m`
- `--provider`
- `--thinking`
- `--tools`
- `--no-tools`

#### `getInheritedAgentRuntimeSettings(agent: AgentConfig, cliOverrides: AgentFlagCliOverrides): AgentRuntimeSettings`

Returns the subset of runtime settings that should still be inherited for top-level `--agent` mode after explicit CLI overrides are applied on a per-field basis.
If a field remains inherited here, the direct-agent runtime is expected to apply it or fail hard rather than silently falling back.

#### `formatSelectedAgentPrompt(agent: AgentConfig | undefined): string`

Formats one selected discovered agent for direct top-level prompt injection:

- returns `""` when no agent is selected or its `systemPrompt` is blank
- otherwise returns `"\n\n<system_reminder type=\"selected-agent-prompt\">...` with the original markdown body inside that XML wrapper
- preserves the original markdown body content so top-level `--agent` uses the same prompt text source as child subagent execution while keeping a hard section boundary

### Accepted agent frontmatter

Discovery relies on these frontmatter fields:

- `name` — required; files without it are skipped
- `description` — required; files without it are skipped
- `meta` — optional author-only string; ignored by discovery/runtime and not exposed to parent agents
- `tools` — optional comma-separated string of tool names; built-ins and extension tools share the same namespace here, and omitted/blank resolves to an empty allowlist
- `model` — optional string, possibly an alias

All remaining markdown body content is passed through as the agent system prompt.

### Runtime-facing `AgentConfig` fields

The subagent runtime consumes discovery results as follows:

- `name` selects the requested agent in single and parallel modes
- `source` drives project-agent confirmation and debug output
- `filePath` appears in debug output
- delegated child `pi` invocations use `--agent <name>`, so the discovered `model`, `tools`, and prompt body flow through the same direct-agent inheritance path as top-level `--agent`
- `tools` is an exact allowlist for the agent across built-in and extension tools; omitted/blank means the agent inherits an empty tool set unless the CLI explicitly overrides it
- `systemPrompt` is inherited through the shared direct-agent path rather than bespoke child-process prompt injection
- in top-level `--agent <name>` mode, the same runtime-facing fields are inherited into the parent session: prompt body, model, thinking level, and the exact tool allowlist
- `--tools` and `--no-tools` are highest-precedence PUT-style overrides for tool selection: if either is present, agent-derived tool inheritance is skipped entirely
- explicit CLI flags override inherited fields on a per-field basis instead of disabling all inheritance

If the requested agent name is missing, runtime returns an error containing the list of available agent names.

## 6. Testing

`pi-extensions/extensions/subagent/agents.test.ts` provides automated coverage for key discovery behavior, including:

- XML prompt formatting for discovered agents
- selected-agent prompt formatting and name lookup helpers used by top-level `--agent`
- runtime-setting extraction and CLI override filtering helpers used by top-level `--agent`
- package/user/project override precedence
- tool normalization and model alias resolution in discovered configs
- author-only `meta` frontmatter being ignored by runtime-facing discovery output
- isolation from bundled repo agents when temp dirs are supplied explicitly

Additional verification remains code-level and runtime-level:

- `debug-agents` exposes the effective merged list plus source-specific user/project sections for manual inspection.
- The `subagent` tool exercises the discovered configuration by spawning child `pi` processes with the resolved model, tool set, and prompt.
- `pi --agent <name>` exercises the same discovery layer for direct top-level inheritance of prompt/model/thinking/tools.
- Repo-wide checks (`npm run lint`, `npm run typecheck`, `npm run test`) provide static validation and package-level tests.

## 7. Open Questions

- Should the frontmatter schema eventually support structured tool arrays instead of a comma-separated string?
- Should `formatAgentList` remain part of the public module surface if it is only a presentation helper?
- Should model alias resolution grow beyond OpenAI/OpenAI Codex-backed environments, or is conservative pass-through the intended long-term behavior?

## 8. Code Locations

- `pi-extensions/extensions/README.md`
- `pi-extensions/extensions/subagent/`
- `pi-extensions/extensions/subagent/agents.ts`
- `pi-agents/*.md`
- `.pi/settings.json` (local development example affecting nearest-settings resolution in this repo)

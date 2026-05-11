# Agent Discovery and Configuration Specification

**Status:** Implemented
**Last Updated:** 2026-05-11

## 1. Overview

### Purpose

The subagent extension needs a stable way to find delegation targets, normalize them into Pi-ready runtime configuration, and expose enough metadata for both execution and debugging. This domain covers markdown-backed agent definitions and named fan-out swarm definitions backed by `swarm.json`; how those definitions are discovered from package, user, and project locations; how agent frontmatter fields are parsed into `AgentConfig`; how tool and model metadata are normalized; and how the resulting catalog is handed to the subagent runtime.

### Goals

- Discover agents from bundled package content plus optional user and project directories.
- Return a uniform `AgentConfig` shape regardless of source file location.
- Present Pi with one effective merged list of available delegation targets.
- Re-read agent markdown and swarm configuration on each discovery call so edits take effect without restarting Pi.
- Discover user/project/package swarm definitions that fan out one tool call to multiple named agent members.
- Reject ambiguous effective target catalogs where an agent and a swarm claim the same name.
- Allow agents to be hidden from the parent prompt inventory without removing them from discovery or explicit name-based execution.
- Preserve source metadata for debug output and project-agent confirmation.
- Allow direct top-level selection of one discovered agent config via `--agent <name>`.
- Normalize legacy Claude-flavored tool names while treating agent `tools` as an exact allowlist across built-in and extension tools.
- Parse declared model policy at the discovery boundary into ordered candidates and per-agent config errors.
- Apply deterministic source precedence so agent name collisions resolve predictably.

### Non-Goals

- Executing agent tasks or managing agent process lifecycle. That belongs to the subagent runtime in `pi-extensions/tools/subagent/`.
- Validating rich agent schemas beyond the required frontmatter fields. Discovery assumes frontmatter is parseable and that `tools`, when present, behaves like a string.
- Merging multiple definitions of the same agent across sources. Agent-agent collisions are resolved by replacement, not composition.
- Executing swarm members, aggregating member output, or managing swarm resume. That belongs to the subagent runtime in `pi-extensions/tools/subagent/`.
- Supporting arbitrary external tool names. Tool normalization is intentionally narrow and conservative.
- Executing model-chain retry behavior; discovery only parses and carries model policy for runtime validation/execution.
- Exposing user/project/both discovery scopes to Pi-facing runtime selection.

## 2. Design Decisions

- **Decision:** Agents are defined as markdown files with frontmatter and prompt body.
  - **Rationale:** A single file can carry both runtime metadata and the system prompt, while also allowing author-only notes such as `meta`, matching how bundled agents in `pi-agents/*.md` are authored.

- **Decision:** Pi sees one merged target list rather than choosing among discovery scopes.
  - **Rationale:** Runtime behavior is simpler when user/project/package sources are a discovery concern, not a tool-call concern.

- **Decision:** `hidden: true` removes an agent from the parent prompt inventory only; it does not remove the agent from discovery.
  - **Rationale:** Some agents should remain callable via `subagent` or `--agent` by operators who know their names without advertising them to the parent agent's general delegation chooser.

- **Decision:** Direct top-level agent mode reuses the same merged discovery result as delegated subagent runs.
  - **Rationale:** `pi --agent <name>` should honor the same package → user → project override semantics as the `subagent` tool and child runtime.

- **Decision:** Agent and swarm discovery is evaluated at call time, not cached for the process lifetime.
  - **Rationale:** Changes to markdown-backed agent definitions or swarm membership should be visible to the next `subagent` invocation, `--agent` lookup, or `/debug-agents` call without a Pi restart.

- **Decision:** Top-level `--agent` inheritance is derived from shared runtime-setting helpers rather than ad hoc field reads in the extension entrypoint.
  - **Rationale:** When new runtime-facing agent fields are added over time, extending the shared helper layer keeps child subagent execution and top-level direct-agent mode aligned.

- **Decision:** Explicit CLI flags override inherited agent fields on a per-field basis.
  - **Rationale:** Users should be able to adopt an agent wholesale and still override just model, thinking, or tools without losing the rest of the agent-defined behavior.

- **Decision:** Source precedence for same-kind definitions is implemented with a name-keyed `Map`.
  - **Rationale:** Replacement semantics are simple and deterministic, and they let user or project agents/swarms override bundled defaults without extra merge rules.

- **Decision:** Source-specific lists are still returned for debugging.
  - **Rationale:** Humans sometimes need to understand where definitions came from even though Pi should not care.

- **Decision:** Discovery is best-effort for filesystem and JSON access, but not for all frontmatter shape errors.
  - **Rationale:** `readJsonFile`, directory reads, and file reads are wrapped defensively, but `parseFrontmatter(...)` and `frontmatter.tools?.split(",")` are not guarded per file. In practice, unreadable files are skipped, while malformed frontmatter or unexpected `tools` types can still abort discovery.

- **Decision:** Agent `tools` is an exact allowlist over the full active tool namespace, not just built-ins.
  - **Rationale:** Built-in and extension tools must obey the same least-privilege contract. If an agent file does not name `subagent`, `questionnaire`, or any other extension tool, direct `--agent` mode and delegated child runs must not quietly keep that tool active.

- **Decision:** Tool normalization is only lossy for unsupported Claude-only aliases.
  - **Rationale:** Known Claude aliases should map to Pi equivalents, unsupported Claude tools such as `task`, `websearch`, `webfetch`, and `skill` should be dropped, and all other tool names should be preserved so extension-defined tools remain configurable from agent frontmatter.

- **Decision:** Discovery does not rewrite model aliases.
  - **Rationale:** Agent model strings should use Pi's normal model resolution path. Keeping alias policy out of the subagent extension avoids a second model naming layer.

- **Decision:** Declared `model` policy is parsed at the discovery boundary and malformed policy is recorded per agent.
  - **Rationale:** Discovery can preserve enough error detail for strict startup validation and target-scoped runtime validation without aborting every snapshot unconditionally.

- **Decision:** Agents and swarms share one effective delegation namespace, and cross-kind name collisions are hard errors.
  - **Rationale:** The parent agent calls a single `agent` field and should not have to reason about target kinds. Failing during discovery/session initialization avoids a runtime surprise where `review` sometimes means one agent and sometimes means a fan-out swarm.

- **Decision:** Swarm member names resolve against the effective agent catalog, including agents colocated with the swarm definition.
  - **Rationale:** Users should be able to define a project-specific review panel and its specialist reviewers together, while still reusing package/user agents by name when desired.

- **Decision:** Swarms are advertised to the parent as normal callable targets, but direct top-level `--agent <name>` remains single-agent only unless explicitly extended later.
  - **Rationale:** Swarms are a delegation/runtime fan-out feature. A top-level session cannot cleanly inherit multiple prompts, models, and tool allowlists without adding a separate design.

## 3. Architecture

Agent discovery is implemented in `pi-extensions/tools/subagent/agents.ts` and consumed by the subagent runtime in `pi-extensions/tools/subagent/`. Swarm discovery is implemented in the same boundary so runtime target resolution receives one validated catalog.

### Discovery pipeline

1. `discoverAgents(cwd)` derives three candidate roots:
   - bundled package agents from `findBundledAgentsDir()`
   - user agents from `path.join(getAgentDir(), "agents")`
   - project agents from the nearest ancestor `.pi/agents` directory via `findNearestProjectAgentsDir(cwd)`
2. Each discovered directory is loaded through `loadAgentsFromDir(dir, source, env)`.
3. Each markdown file is parsed with `parseFrontmatter(...)`.
4. Required frontmatter fields plus optional runtime visibility metadata are projected into `AgentConfig`, while the markdown body becomes `systemPrompt`.
5. `normalizeTools(...)` maps the optional `tools` list into Pi tool names.
6. `parseModelPolicy(...)` parses optional `model` frontmatter into ordered `modelCandidates`, preserves the first accepted candidate as `model`, or records `modelPolicyError` on that agent.
7. A `Map<string, AgentConfig>` applies source precedence by agent name and produces the final effective `agents` array.
8. Swarm discovery loads `swarm.json` definitions from source-specific swarm roots and applies same-kind swarm precedence in one merged `swarms` view while still retaining `userSwarms`/`projectSwarms`.
9. Swarm folder `.md` files are loaded with the same source before swarm merging so a swarm can reference colocated members.
10. The same discovery pass also returns raw `userAgents` and `projectAgents` lists for debug output.

### Source locations and precedence

Discovery supports three agent sources:

- **package** — bundled agents under repo-level `pi-agents/` (with legacy fallback support for `pi-extensions/agents/`)
- **user** — agents under `~/.pi/agent/agents`
- **project** — agents under the nearest ancestor `.pi/agents`

Swarm sources mirror this model:

- **package** — package-provided swarm folders, when shipped
- **user** — swarm folders under `~/.pi/agent/swarms/<name>/swarm.json`
- **project** — swarm folders under the nearest ancestor `.pi/swarms/<name>/swarm.json`

A swarm folder may also contain markdown agent files. Those agents are loaded as part of the same source before member-name validation, so a self-contained folder can define both the panel and its specialists.

Precedence is name-based and deterministic within each target kind:

- package agents/swarms are inserted first
- user agents/swarms overwrite package definitions of the same kind with the same name
- project agents/swarms overwrite both package and user definitions of the same kind with the same name

There is no field-by-field merge. The later source replaces the earlier same-kind definition for the same `name`. After same-kind precedence is applied, any effective agent and effective swarm with the same name is a hard discovery error.

### Effective vs source-specific views

Discovery returns multiple views from one pass:

- `agents` — the effective merged list of single-agent targets
- `swarms` — the effective merged list of swarm targets
- `userAgents` — raw user-defined agents for debug inspection
- `projectAgents` — raw project-local agents for debug inspection
- `userSwarms` — raw user-defined swarms for debug inspection
- `projectSwarms` — raw project-local swarms for debug inspection
- `projectAgentsDir` — nearest project agent directory, if present
- `projectSwarmsDir` — nearest project swarm directory, if present

This keeps Pi-facing behavior simple while preserving source visibility for humans. Because discovery is run on demand, markdown edits are picked up on the next call rather than requiring a long-lived cache flush.

### Model policy parsing

The public model field remains `model`. Omitted `model` means the agent inherits the parent/default Pi model and produces no candidates. Present `model` may be a non-empty string, an object with `id` and optional `when`, or a non-empty list of strings and/or objects.

Discovery accepts only the v1 `when` grammar:

- `$VAR`
- `!$VAR`
- `$VAR == "value"`
- `$VAR != 'value'`

Environment variable names must match `[A-Za-z_][A-Za-z0-9_]*`. Truthiness is presence plus non-empty raw value; the literal string `false` is truthy. Surrounding expression whitespace is ignored, while environment values are compared without trimming.

Accepted entries are normalized into `modelCandidates` in declaration order, with duplicate model IDs removed after parsing while preserving the first occurrence. The first candidate is also exposed as `model` so existing runtime-setting helpers keep their single-string behavior until later slices consume the full chain.

Malformed declared policy does not abort the whole discovery snapshot. Instead, the affected agent carries a `modelPolicyError` with a clear reason. Invalid cases include empty model lists, unsupported `when` expressions, unknown object keys, missing or blank `id`, and policies that leave no candidates after gating.

Discovery does not rewrite aliases such as `sonnet` or `haiku`; model strings are passed through for Pi model resolution later.

### Runtime integration boundary

The subagent runtime uses discovery results in four places:

- `before_agent_start` discovers targets on demand and injects a terse XML list of visible subagent/swarm names and descriptions into the parent agent system prompt.
- when `--agent <name>` is set, the same discovery result resolves the selected single agent by name, derives inherited runtime settings from that `AgentConfig`, applies model/thinking/tools unless explicit CLI flags override those fields, and appends the agent's `systemPrompt` wrapped in `<system-reminder type="selected-agent-prompt">` to the parent system prompt.
- `debug-agents` renders the effective agent and swarm lists plus source-specific user/project sections.
- `subagent` execution resolves the requested name against the effective target catalog; single-agent targets use the current one-child path, while swarm targets fan out through runtime orchestration.

This means discovery is the configuration boundary; runtime execution trusts the normalized `AgentConfig` or swarm target it receives.

## 4. Data Model

Core exported types from `pi-extensions/tools/subagent/agents.ts`:

```ts
export interface AgentModelCandidate {
	id: string;
}

export interface AgentConfig {
	name: string;
	description: string;
	hidden: boolean;
	tools: string[];
	model?: string;
	modelCandidates?: AgentModelCandidate[];
	modelPolicyError?: string;
	systemPrompt: string;
	source: "package" | "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	userAgents: AgentConfig[];
	projectAgents: AgentConfig[];
	projectAgentsDir: string | null;
	swarms: SwarmConfig[];
	userSwarms: SwarmConfig[];
	projectSwarms: SwarmConfig[];
	projectSwarmsDir: string | null;
}
```

Swarm discovery adds a parallel target shape without changing the single-agent config contract:

```ts
export interface SwarmConfig {
	name: string;
	description: string;
	hidden: boolean;
	members: string[];
	source: "package" | "user" | "project";
	filePath: string;
}

export type DelegationTarget =
	| { kind: "agent"; agent: AgentConfig }
	| { kind: "swarm"; swarm: SwarmConfig };
```

The exact exported names may differ, but the runtime boundary is: discovery returns validated single-agent targets and validated swarm targets in one collision-free namespace.

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
- `pi-agents/fixer.md`

These files use YAML frontmatter for `name`, `description`, optional author-only `meta`, optional `hidden`, and optional `tools` / `model`, followed by a markdown prompt body that becomes `systemPrompt`.

Swarm folders use `swarm.json` plus optional colocated agent markdown files:

```text
.pi/swarms/review/
  swarm.json
  correctness-review.md
  security-review.md
  maintainability-review.md
```

Minimal `swarm.json` shape:

```json
{
	"name": "review",
	"description": "Run the configured review panel",
	"members": ["correctness-review", "security-review", "maintainability-review"]
}
```

`hidden: true` may be added to hide a swarm from the parent prompt inventory while keeping explicit name-based execution available.

## 5. Interfaces

### Exported discovery API

#### `discoverAgents(cwd: string): AgentDiscoveryResult`

Returns the resolved agent catalog for a working directory.

The API is called by the subagent runtime and by direct `--agent` startup. Runtime callers can resolve a requested name to either one `AgentConfig` or one validated `SwarmConfig`.

The implementation re-reads markdown files each time it is called; there is no process-lifetime cache of agent bodies or frontmatter.

Behavioral contract:

- bundled package agents are always considered
- user agents are always considered
- project agents are loaded from the nearest ancestor `.pi/agents`, when present
- user/project/package swarms are loaded from source-specific `swarms/<name>/swarm.json` folders
- swarm-local markdown files are loaded before validating that swarm's member list
- `projectAgentsDir` reports the nearest project agent directory even when no project agents are ultimately loaded
- unreadable directories, unreadable files, and invalid JSON settings fail closed by omission rather than throwing
- agent frontmatter is expected to be parseable, and `tools` is expected to be string-like when present; parse/type errors in those paths are not isolated per file by the current implementation
- cross-kind name collisions and unknown swarm members are hard errors surfaced during discovery/session initialization

#### `formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number }`

Formats a short human-readable list such as `name (source): description` and reports how many items were omitted.

#### `formatAgentsForPrompt(agents: AgentConfig[], swarms: SwarmConfig[] = []): string`

Formats discovered targets for system-prompt injection as:

- an outer `<system-reminder type="available-subagents">` wrapper
- a terse lead-in line: `These are the available subagents with their intended use.`
- an inner XML list under `<available-subagents>`
- one `<subagent>` entry per visible agent or swarm containing `<name>` and `<description>` only
- agents/swarms with `hidden: true` are omitted from this prompt-formatting output entirely

Swarm targets use the same parent-facing XML shape as single agents.
The parent agent should not need to know whether a listed name resolves to one agent or a swarm.

#### `findAgentByName(agents: AgentConfig[], name: string | undefined | null): AgentConfig | undefined`

Returns the effective discovered agent whose `name` exactly matches the trimmed requested name.
Returns `undefined` for blank or missing names.

#### `findDelegationTarget(discovery: AgentDiscoveryResult, name: string | undefined | null): DelegationTarget | undefined`

Resolves a target name to either an agent or swarm entry from the merged catalogs.
Returns `undefined` for blank names, unknown names, or names that are not present in either effective list.

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
- otherwise returns `"\n\n<system-reminder type=\"selected-agent-prompt\">...` with the original markdown body inside that XML wrapper
- preserves the original markdown body content so top-level `--agent` uses the same prompt text source as child subagent execution while keeping a hard section boundary

### Accepted agent frontmatter

Discovery relies on these frontmatter fields:

- `name` — required; files without it are skipped
- `description` — required; files without it are skipped
- `meta` — optional author-only string; ignored by discovery/runtime and not exposed to parent agents
- `hidden` — optional boolean/string flag; truthy `true` hides the agent from parent prompt inventory while keeping it discoverable and callable by explicit name
- `tools` — optional comma-separated string of tool names; built-ins and extension tools share the same namespace here, and omitted/blank resolves to an empty allowlist
- `model` — optional unified model policy: non-empty string, object with `id` and optional `when`, or non-empty ordered list of strings/objects. Discovery does not rewrite aliases.

All remaining markdown body content is passed through as the agent system prompt.

### Runtime-facing `AgentConfig` fields

The subagent runtime consumes discovery results as follows:

- `name` selects the requested agent for one subagent tool invocation
- `hidden` suppresses parent prompt inventory exposure without affecting explicit lookup, debug output, or execution
- `source` drives project-agent confirmation and debug output
- `filePath` appears in debug output
- delegated child `pi` invocations use `--agent <name>`, so the discovered `model`, `tools`, and prompt body flow through the same direct-agent inheritance path as top-level `--agent`
- `tools` is an exact allowlist for the agent across built-in and extension tools; omitted/blank means the agent inherits an empty tool set unless the CLI explicitly overrides it
- `systemPrompt` is inherited through the shared direct-agent path rather than bespoke child-process prompt injection
- in top-level `--agent <name>` mode, the same runtime-facing fields are inherited into the parent session: prompt body, model, thinking level, and the exact tool allowlist
- `--tools` and `--no-tools` are highest-precedence PUT-style overrides for tool selection: if either is present, agent-derived tool inheritance is skipped entirely
- explicit CLI flags override inherited fields on a per-field basis instead of disabling all inheritance

If the requested single-agent name is missing, runtime returns an error containing the list of available agent names.

### Runtime-facing `SwarmConfig` fields

The subagent runtime consumes swarm discovery results as follows:

- `name` selects the swarm target from the same `agent` tool parameter used for single agents
- `description` is advertised to the parent in the same available-subagents inventory
- `hidden` suppresses parent prompt inventory exposure without affecting explicit lookup, debug output, or execution
- `members` is the validated ordered list of effective agent names to run.
- `source` and `filePath` appear in debug output and support the same project-source policy hooks as agents

A swarm member must resolve to a single agent, not another swarm. Nested swarms are out of scope until a separate scheduling design exists.

## 7. Open Questions

- Should the frontmatter schema eventually support structured tool arrays instead of a comma-separated string?
- Should `formatAgentList` remain part of the public module surface if it is only a presentation helper?
- Should model alias resolution grow beyond OpenAI/OpenAI Codex-backed environments, or is conservative pass-through the intended long-term behavior?
- Should direct top-level `--agent <name>` ever support swarm targets, or should swarms remain delegation-only?

## 8. Code Locations

- `pi-extensions/README.md`
- `pi-extensions/tools/subagent/`
- `pi-extensions/tools/subagent/agents.ts`
- `pi-extensions/tools/subagent/index.ts`
- `pi-agents/*.md`
- `.pi/settings.json` (local development example affecting nearest-settings resolution in this repo)

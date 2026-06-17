# Agent Discovery and Configuration Specification

**Status:** Implemented
**Last Updated:** 2026-06-11

## 1. Overview

### Purpose

The subagent extension needs a stable way to find delegation targets, normalize them into Pi-ready runtime configuration, and expose enough metadata for both execution and debugging. This domain covers markdown-backed agent definitions and named fan-out swarm definitions backed by `swarm.json`; how those definitions are discovered from package, user, and project locations; how agent frontmatter fields are parsed into `AgentConfig`; how tool and model metadata are normalized; and how the resulting catalog is handed to the subagent runtime.

Claude Code compatibility is based on the Claude Code subagent frontmatter reference supplied on 2026-06-17: fields include `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, and `initialPrompt`; Pi currently maps only `tools`, `disallowedTools`, `model`, and `effort` from that set beyond fields it already supported.

### Goals

- Discover agents from bundled package content plus optional user, project, and `--agents-dir` directories.
- Return a uniform `AgentConfig` shape regardless of source file location.
- Present Pi with one effective merged list of available delegation targets.
- Re-read agent markdown and swarm configuration on each discovery call so edits take effect without restarting Pi.
- Discover user/project/package swarm definitions that fan out one tool call to multiple named agent members.
- Reject ambiguous effective target catalogs where an agent and a swarm claim the same name.
- Allow agents to be hidden from the parent prompt inventory without removing them from discovery or explicit name-based execution.
- Preserve source metadata for debug output and project-agent confirmation.
- Allow direct top-level selection of one discovered agent config via `--agent <name>`.
- Normalize Claude Code-compatible `tools` and `disallowedTools` declarations through a user-editable compatibility map while treating agent `tools` as an exact allowlist across built-in and extension tools.
- Parse declared model policy at the discovery boundary into ordered candidates and per-agent config errors, mapping Claude Code model aliases and `effort` through compatibility settings.
- Parse Claude Code-style `mcpServers` frontmatter into normalized server configs, recording per-agent config errors for malformed declarations.
- Connect an adopted/spawned agent's MCP servers and expose their tools to that agent, namespaced to avoid collisions.
- Apply deterministic source precedence so agent and swarm name collisions resolve predictably, including repeatable `--agents-dir` roots.

### Non-Goals

- Executing agent tasks or managing agent process lifecycle. That belongs to the subagent runtime in `pi/extensions/tools/subagent/`.
- Validating rich agent schemas beyond the required frontmatter fields. Discovery assumes frontmatter is parseable and that `tools`, when present, behaves like a string.
- Merging multiple definitions of the same agent across sources. Agent-agent collisions are resolved by replacement, not composition.
- Executing swarm members, aggregating member output, or managing swarm resume. That belongs to the subagent runtime in `pi/extensions/tools/subagent/`.
- Supporting arbitrary external tool names. Tool normalization is intentionally narrow and conservative.
- Executing model-chain retry behavior; discovery only parses and carries model policy for runtime validation/execution.
- Exposing user/project/both discovery scopes to Pi-facing runtime selection.

## 2. Design Decisions

- **Decision:** Agents are defined as markdown files with frontmatter and prompt body.
  - **Rationale:** A single file can carry both runtime metadata and the system prompt, while also allowing author-only notes such as `meta`, matching how bundled agents in `pi/agents/*.md` are authored.

- **Decision:** Pi sees one merged target list rather than choosing among discovery scopes.
  - **Rationale:** Runtime behavior is simpler when user/project/package/flag sources are a discovery concern, not a tool-call concern.

- **Decision:** Repeatable `--agents-dir <root>` contributes external roots after project discovery, and later flags override earlier flags for same-name targets.
  - **Rationale:** Operators need an explicit way to inject shared external agents/swarms without copying them into every repo, while keeping precedence deterministic and aligned across direct mode, delegated runs, debug commands, and prompt injection.

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
  - **Rationale:** Built-in and extension tools must obey the same least-privilege contract. If an agent file does not name `subagent` or any other extension tool, direct `--agent` mode and delegated child runs must not quietly keep that tool active.

- **Decision:** Claude Code compatibility mappings live in `~/.pi/agent/extensions/pi-subagent/settings.json`, created on first discovery if missing.
  - **Rationale:** Agent authors can copy Claude Code subagent frontmatter while Pi keeps mapping policy explicit and user-editable. The default file maps known Claude tool names to Pi tool names (`Read` → `read`, `Agent` → `subagent`, etc.), drops unsupported Claude-only tools with `null`, maps Claude model aliases (`haiku`, `sonnet`, `opus`, `fable`) to current Pi model IDs, and maps Claude `effort` to Pi thinking levels.

- **Decision:** Tool normalization is conservative and permission-pattern agnostic.
  - **Rationale:** Known Claude aliases should map to Pi equivalents, unsupported or unrecognized Claude tools should be dropped, and Claude permission syntax such as `Bash(git:*)` or `Agent(worker)` should be reduced to the outer tool name because Pi does not implement that permission model.

- **Decision:** Claude Code model aliases are rewritten only through the compatibility settings map; provider-qualified Pi model IDs continue through Pi's normal model resolution path.
  - **Rationale:** We should not guess at Claude model names. A copied Claude alias must be mapped explicitly, while existing Pi-native agent files remain valid.

- **Decision:** Declared `model` policy is parsed at the discovery boundary and malformed policy is recorded per agent.
  - **Rationale:** Discovery can preserve enough error detail for strict startup validation and target-scoped runtime validation without aborting every snapshot unconditionally.

- **Decision:** `mcpServers` is parsed at the discovery boundary into normalized configs, and malformed declarations are recorded per agent as `mcpServersError` rather than aborting discovery.
  - **Rationale:** Mirrors model-policy handling. A single bad MCP block should not break the whole catalog or every top-level session, but the error must still surface clearly when that agent is adopted or smoke-tested.

- **Decision:** `mcpServers` uses the Claude Code list-of-single-key-maps shape (a YAML list where each item maps one server name to its config), supporting remote (`type`/`url`/`headers`) and local stdio (`command`/`args`/`env`) transports.
  - **Rationale:** Authors can copy existing Claude subagent frontmatter verbatim. A plain object map is rejected with a message pointing to the list syntax.

- **Decision:** MCP servers are connected when the agent is adopted (`--agent`) or spawned (delegated), not during discovery; their tools are registered namespaced as `mcp__<server>__<tool>` and added to the active tool set.
  - **Rationale:** Discovery stays pure and network-free. Connection cost and credentials only matter for the session that actually uses the agent, and namespacing keeps server tools from colliding with built-ins or each other. Connection failures (for example a headless OAuth rejection) are non-fatal warnings so the agent can still run.

- **Decision:** Agents and swarms share one effective delegation namespace, and cross-kind name collisions are hard errors.
  - **Rationale:** The parent agent calls a single `agent` field and should not have to reason about target kinds. Failing during discovery/session initialization avoids a runtime surprise where `review` sometimes means one agent and sometimes means a fan-out swarm.

- **Decision:** Swarm member names resolve against the effective agent catalog, including agents colocated with the swarm definition.
  - **Rationale:** Users should be able to define a project-specific review panel and its specialist reviewers together, while still reusing package/user agents by name when desired.

- **Decision:** Swarms are advertised to the parent as normal callable targets, but direct top-level `--agent <name>` remains single-agent only unless explicitly extended later.
  - **Rationale:** Swarms are a delegation/runtime fan-out feature. A top-level session cannot cleanly inherit multiple prompts, models, and tool allowlists without adding a separate design.

## 3. Architecture

Agent and swarm discovery live inside the `pi/extensions/tools/subagent/` module and are consumed by the same module's runtime entrypoint, so target resolution receives one validated catalog.

### Discovery pipeline

1. `discoverAgents(cwd)` derives bundled, user, and project defaults plus any normalized CLI `--agents-dir` roots.
2. Each discovered directory is loaded through `loadAgentsFromDir(dir, source, env)`.
3. Each markdown file is parsed with `parseFrontmatter(...)`.
4. Required frontmatter fields plus optional runtime visibility metadata are projected into `AgentConfig`, while the markdown body becomes `systemPrompt`.
5. `normalizeTools(...)` maps the optional `tools` list into Pi tool names.
6. `parseModelPolicy(...)` parses optional `model` frontmatter into ordered `modelCandidates`, preserves the first accepted candidate as `model`, or records `modelPolicyError` on that agent.
7. Each `--agents-dir <root>` is shell-expanded (`~`, `$VAR`, `${VAR}`), resolved once against the startup cwd, deduplicated by latest occurrence, then contributes `<root>/agents` plus any swarm-local agent markdown under `<root>/swarms/*/*.md`.
8. A `Map<string, AgentConfig>` applies source precedence by agent name and produces the final effective `agents` array.
9. Swarm discovery loads `swarm.json` definitions from source-specific swarm roots and applies same-kind swarm precedence in one merged `swarms` view while still retaining `userSwarms`/`projectSwarms`.
10. Swarm folder `.md` files are loaded with the same source before swarm merging so a swarm can reference colocated members.
11. The same discovery pass also returns raw `userAgents` and `projectAgents` lists for debug output.

### Source locations and precedence

Discovery supports four agent sources:

- **package** — bundled agents under repo-level `pi/agents/`.
- **user** — agents under `~/.pi/agent/agents`
- **project** — agents under the nearest ancestor `.pi/agents`
- **flag** — each `--agents-dir <root>` contributes `<root>/agents`

Swarm sources mirror this model:

- **package** — package-provided swarm folders, when shipped
- **user** — swarm folders under `~/.pi/agent/swarms/<name>/swarm.json`
- **project** — swarm folders under the nearest ancestor `.pi/swarms/<name>/swarm.json`
- **flag** — each `--agents-dir <root>` contributes `<root>/swarms/<name>/swarm.json`

A swarm folder may also contain markdown agent files. Those agents are loaded as part of the same source before member-name validation, so a self-contained folder can define both the panel and its specialists.

Precedence is name-based and deterministic within each target kind:

- package agents/swarms are inserted first
- user agents/swarms overwrite package definitions of the same kind with the same name
- project agents/swarms overwrite both package and user definitions of the same kind with the same name
- `--agents-dir` roots are applied last in CLI order, so later flags overwrite earlier flags for the same kind and name

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

Environment variable names must match `[A-Za-z_][A-Za-z0-9_]*`. Truthiness treats missing, empty, `false`, `0`, `no`, and `off` as false; false-like checks are case-insensitive. Surrounding expression whitespace is ignored, while equality comparisons use raw environment values without trimming.

Accepted entries are normalized into `modelCandidates` in declaration order, with duplicate model IDs removed after parsing while preserving the first occurrence. The first candidate is also exposed as `model` so existing runtime-setting helpers keep their single-string behavior until later slices consume the full chain.

Malformed declared policy does not abort the whole discovery snapshot. Instead, the affected agent carries a `modelPolicyError` with a clear reason. Invalid cases include empty model lists, unsupported `when` expressions, unknown object keys, missing or blank `id`, and policies that leave no candidates after gating.

Discovery does not rewrite aliases such as `sonnet` or `haiku`; model strings are passed through for Pi model resolution later.

### Runtime integration boundary

The subagent runtime uses discovery results in four places:

- `before_agent_start` discovers targets on demand and injects a terse XML list of visible subagent/swarm names and descriptions into the parent agent system prompt.
- when `--agent <name>` is set, the same discovery result resolves the selected single agent by name, derives inherited runtime settings from that `AgentConfig`, applies model/thinking/tools unless explicit CLI flags override those fields, and appends the agent's `systemPrompt` wrapped in `<system-reminder type="selected-agent-prompt">` to the parent system prompt.
- `debug-agents` renders the effective agent and swarm lists plus source-specific user/project sections.
- `subagent` execution resolves the requested name against the effective target catalog; single-agent targets use the current one-child path, while swarm targets fan out through runtime orchestration.
- when a spawned or adopted agent declares `mcpServers`, the runtime connects each server, registers its tools under `mcp__<server>__<tool>`, and adds those names to the active tool set. `mcpServersError` is a hard failure on adoption; connection failures are non-fatal warnings. `--debug-mcp <agent>` and `/debug-mcp <agent>` run a headless smoke test that connects the servers and reports their tools or the connection/config error.

MCP connection and tool registration live in `pi/extensions/tools/subagent/mcp.ts` (pure parsing plus network client helpers) and `mcp-runtime.ts` (Pi-side tool registration). Discovery itself never opens a connection.

This means discovery is the configuration boundary; runtime execution trusts the normalized `AgentConfig` or swarm target it receives.

`--agents-dir` is a startup-only CLI input. Current session persistence does not serialize and replay prior `--agents-dir` values for later top-level `--continue` / `--resume`; operators must pass those flags again when they need the same external catalog.

## 4. Data Model

Discovery's public contract is exported by the `pi/extensions/tools/subagent/` module: single-agent configs, swarm configs, the merged discovery result, and delegation target resolution. The spec intentionally does not duplicate those TypeScript interfaces; the module is the source of truth for exact fields and signatures.

At the boundary, discovery returns:

- a collision-free effective namespace of visible and hidden single-agent targets
- a collision-free effective namespace of swarm targets
- source-specific user/project views for debug rendering
- project directory metadata for debug rendering and project-source confirmation
- per-agent model-policy parse errors where malformed model frontmatter should be surfaced without discarding the whole catalog

Bundled agents in this repo demonstrate the markdown file format discovery expects. See `pi/agents/` for package agents and `pi/agents/*/swarm.json` for package swarms.

User and project swarm folders use `swarm.json` plus optional colocated agent markdown files. A minimal swarm declares a `name`, `description`, and ordered `members` array. `hidden: true` may be added to hide a swarm from the parent prompt inventory while keeping explicit name-based execution available.

## 5. Interfaces

The `pi/extensions/tools/subagent/` module provides the API used by the subagent tool and direct `--agent` startup mode to:

- discover the effective target catalog for a working directory
- format visible targets for parent prompt injection and debug output
- resolve names to either a single agent or a swarm target
- derive runtime settings from a selected agent
- parse explicit CLI overrides for direct `--agent` inheritance
- format the selected agent prompt wrapper for top-level sessions

Behavioral contract:

- bundled package agents are always considered
- user agents are always considered
- project agents are loaded from the nearest ancestor `.pi/agents`, when present
- each `--agents-dir <root>` contributes optional `<root>/agents` and `<root>/swarms` directories after shell expansion and cwd-relative resolution
- user/project/package/flag swarms are loaded from source-specific `swarms/<name>/swarm.json` folders
- swarm-local markdown files are loaded before validating that swarm's member list
- project directory metadata reports the nearest project directories even when no project targets are ultimately loaded
- unreadable directories, unreadable files, and invalid JSON settings fail closed by omission rather than throwing
- agent frontmatter is expected to be parseable, and `tools` is expected to be string-like when present; parse/type errors in those paths are not isolated per file by the current implementation
- cross-kind name collisions and unknown swarm members are hard errors surfaced during discovery/session initialization

### Accepted agent frontmatter

Discovery relies on these frontmatter fields:

- `name` — required; files without it are skipped
- `description` — required; files without it are skipped
- `meta` — optional author-only string; ignored by discovery/runtime and not exposed to parent agents
- `hidden` — optional boolean/string flag; truthy `true` hides the agent from parent prompt inventory while keeping it discoverable and callable by explicit name
- `tools` — optional comma/space-separated string or string array of tool names; built-ins and extension tools share the same namespace here, and omitted/blank resolves to an empty allowlist. Claude Code permission patterns in parentheses are ignored during mapping.
- `disallowedTools` — optional comma/space-separated string or string array. Mapped through the same compatibility rules as `tools` and removed from the final allowlist.
- `model` — optional unified model policy: non-empty string, object with `id` and optional `when`, or non-empty ordered list of strings/objects. Claude Code aliases are resolved via `~/.pi/agent/extensions/pi-subagent/settings.json`; provider-qualified Pi IDs pass through to Pi model validation.
- `effort` — optional Claude Code effort hint (`low`, `medium`, `high`, `xhigh`, `max` by default). When mapped, it appends the corresponding Pi thinking suffix to mapped model candidates that do not already declare one.
- `mcpServers` — optional Claude Code-style list of single-key maps. Each entry maps a server name to either a remote config (`type` of `http`/`sse` with a `url` and optional `headers`) or a local stdio config (`command` with optional `args`/`env`). Malformed declarations are recorded as a per-agent `mcpServersError` and leave `mcpServers` empty without aborting discovery.

All remaining markdown body content is passed through as the agent system prompt.

### Runtime consumption

The subagent runtime treats discovery as the configuration boundary. Single-agent targets provide prompt, model/thinking, tool allowlist, source, and debug metadata. Swarm targets provide an ordered, validated member list and use the same parent-facing target namespace as single agents. A swarm member must resolve to a single agent, not another swarm. Nested swarms are out of scope until a separate scheduling design exists.

## 7. Open Questions

- Should the frontmatter schema eventually support structured tool arrays instead of a comma-separated string?
- Should `formatAgentList` remain part of the public module surface if it is only a presentation helper?
- Should model alias resolution grow beyond OpenAI/OpenAI Codex-backed environments, or is conservative pass-through the intended long-term behavior?
- Should direct top-level `--agent <name>` ever support swarm targets, or should swarms remain delegation-only?

## 8. Code Locations

- `pi/extensions/tools/subagent/` — discovery, formatting, direct-agent inheritance, Claude Code compatibility mapping, and runtime consumption
- `pi/extensions/tools/subagent/mcp.ts` — `mcpServers` parsing, MCP client connection, namespacing, smoke test
- `pi/extensions/tools/subagent/mcp-runtime.ts` — Pi-side MCP tool registration for adopted/spawned agents
- `pi/agents/jira-mcp.md` — bundled example agent using the Atlassian MCP server
- `pi/agents/` — bundled package agents and swarms

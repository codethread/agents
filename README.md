# agents

Agent tooling for Pi, Claude Code, and Codex.

## Contents

- `pi/extensions/` — package-shipped Pi extensions grouped into `tools/`, `ui/`, `messaging/`, `cli/`, and `system-prompt/`
- `.pi/extensions/` — project-local Pi extensions for this repository only
- `pi/agents/` — bundled subagents used by the `subagent` extension
- `plugins/` — reusable prompt/skill plugins grouped by domain (`devflow/`, `writing/`, `coding/`, `harness/`)
- `.agents/plugins/marketplace.json` — Codex local marketplace for the repo's plugins
- `pi/themes/` — Pi themes

**Note on Cache Invalidation:** Changing prompt-layer context mid-session, or changing the model/provider, can drop provider prompt-cache reuse. Treat dynamic context injection as a cost/latency tradeoff; keep injected context bounded and stable when possible.

## Install as a Pi package

From a local checkout:

```bash
pi install /absolute/path/to/agents
```

From git later:

```bash
pi install git:github.com/<you>/agents
```

Pi loads the package's extensions from `pi/extensions/`, plugin prompts and skills from `plugins/*/`, themes from `pi/themes/`, through `package.json#pi`. It also auto-loads this checkout's project-local extensions from `.pi/extensions/` when Pi runs inside this repository.
The bundled agents are discovered by the `subagent` extension from `pi/agents/`, so they travel with the package too. Project-specific agents still load from the nearest `.pi/agents/` directory when you run Pi inside another repo, and you can inject extra shared roots with repeatable `--agents-dir <root>` flags.

This package ships a `system-prompt` extension that:

- replaces Pi's generated system prompt with a package-owned structure
- renders tool metadata tool-by-tool, including subagent inventory under the `subagent` tool
- injects global/project `agent.njk` rules

It also ships:

- a `project-structure` messaging extension that sends a bounded project tree as model-visible custom message context
- a `prompt-history` UI extension that recalls previously submitted prompts by canonical repo root or globally across git-backed sessions, while `Up` stays on Pi's built-in editor history

This repository additionally keeps a project-local `.pi/extensions/pi-internals/` tool that agents can call on demand to print Pi runtime/source/settings/enabled-extension paths. It is intentionally local to this checkout rather than shipped as part of the package.

See `pi/extensions/system-prompt/README.md` for prompt-layer extension details and `.pi/extensions/pi-internals/README.md` for project-local Pi internals discovery.

## Install as Codex plugins

Codex discovers this repo through the local marketplace at `.agents/plugins/marketplace.json`. Add the checkout as a Codex marketplace, then install/enable the plugins from `/plugins`:

```bash
codex plugin marketplace add /absolute/path/to/agents
```

This exposes:

- `plugins/coding/`, `plugins/devflow/`, `plugins/writing/`, and `plugins/harness/` as Codex plugins via `.codex-plugin/plugin.json`
- their `skills/` directories as Codex skills
- `plugins/harness/.codex-plugin/hooks/` as Codex lifecycle hooks for dialogue/file-touch capture. Hook commands use Codex's `PLUGIN_ROOT` environment variable so they resolve from the installed plugin root.

Codex custom prompts are deprecated and live under `~/.codex/prompts`, so the `plugins/*/commands/*.md` slash prompts are not mirrored as repo-packaged Codex commands. Convert high-value command workflows into skills when they should be portable to Codex.

Codex also has no direct equivalent for Pi extensions (`pi/extensions/*`) or Pi bundled subagents (`pi/agents/*`). Those remain Pi-specific unless reimplemented as Codex skills, hooks, MCP servers, or future Codex plugin capabilities.

## Bundled agents

- `pi/agents/scout.md` — fast codebase recon and architecture mapping
- `pi/agents/fixer.md` — validation repair and scoped mechanical completion agent
- `pi/agents/hack.md` — shell-first investigation and automation agent
- `pi/agents/review.md` — faster/cheaper single-agent code review for spot checks
- `pi/agents/nerd.md` — web research specialist with Context7 MCP docs access
- `pi/agents/jira-mcp.md` — Jira specialist wired to Atlassian MCP through `mcpServers` frontmatter
- `pi/agents/deep-review/` — multi-role review for a full feature, PR, or session workload; pass commits/diff, PRD/spec/task files, relevant paths, intent, risks, validation results, and any upfront exploration notes so each reviewer starts with shared hot context
- `pi/agents/council/` — multi-role ideation panel for non-trivial decisions where the main agent wants another opinion before reporting back; includes skeptic, evidence scout, simplifier, and scope guard; pass proposed direction, intended outcome, problem, tradeoff/decision, relevant files/specs/code paths, constraints, risks, rejected options, and desired help

## Included plugins

- `plugins/devflow/` — RFC/spec/reviewable-plan/disposable-task skills plus AFK workflow prompts, HITL, shrug, and grill-me prompts
- `plugins/writing/` — skill authoring and Mermaid writing skills
- `plugins/coding/` — git, robustness, writing-tests skills plus coding prompts
- `plugins/harness/` — harness/session affordances: Pi, Claude Code, and Codex session introspection, dialogue-capture hooks, bench orchestration, and rich responses

## Development

The Vitest suite includes both unit/snapshot tests and Pi runtime integration tests backed by `@gaodes/pi-test-harness`.

```bash
pnpm install
pnpm format
pnpm lint
pnpm typecheck
pnpm check
```

Running `pi` from this repo works for local testing because `.pi/settings.json` points Pi at the package root.

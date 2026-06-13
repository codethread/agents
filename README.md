# agents

Pi-specific agent tooling extracted from my dotfiles repo. Still need to port more of the old [claude stuff](https://github.com/codethread/claude-code-plugins).

## Contents

- `pi/extensions/` — package-shipped Pi extensions grouped into `tools/`, `ui/`, `messaging/`, `cli/`, and `system-prompt/`
- `.pi/extensions/` — project-local Pi extensions for this repository only
- `pi/agents/` — bundled subagents used by the `subagent` extension
- `plugins/` — reusable prompt/skill plugins grouped by domain (`devflow/`, `writing/`, `coding/`, `harness/`)
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

It also ships a `project-structure` messaging extension that sends a bounded project tree as model-visible custom message context.

This repository additionally keeps a project-local `.pi/extensions/pi-internals/` tool that agents can call on demand to print Pi runtime/source/settings/enabled-extension paths. It is intentionally local to this checkout rather than shipped as part of the package.

See `pi/extensions/system-prompt/README.md` for prompt-layer extension details and `.pi/extensions/pi-internals/README.md` for project-local Pi internals discovery.

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

- `plugins/devflow/` — AFK workflow prompts/skill plus HITL, shrug, and grill-me prompts
- `plugins/writing/` — skill authoring, spec authoring, and Mermaid writing skills
- `plugins/coding/` — git, robustness, writing-tests skills plus coding prompts
- `plugins/harness/` — harness/session affordances such as Pi session introspection and rich responses

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

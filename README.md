# agents

Pi-specific agent tooling extracted from my dotfiles repo. Still need to port more of the old [claude stuff](https://github.com/codethread/claude-code-plugins).

## Contents

- `pi-extensions/` — Pi extensions grouped into `tools/`, `ui/`, `messaging/`, `cli/`, and `system-prompt/`
- `pi-agents/` — bundled subagents used by the `subagent` extension
- `prompts/` — prompt templates
- `pi-themes/` — Pi themes
- `skills/` — reusable Pi skills

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

Pi loads the package's extensions from `pi-extensions/`, prompts from `prompts/`, themes from `pi-themes/`, and skills from `skills/` through `package.json#pi`.
The bundled agents are discovered by the `subagent` extension from `pi-agents/`, so they travel with the package too. Project-specific agents still load from the nearest `.pi/agents/` directory when you run Pi inside another repo.

This package ships a `system-prompt` extension that:

- owns the base prompt scaffold after custom `SYSTEM.md` setup
- injects global/project `agent.njk` rules

It also ships a `project-structure` messaging extension that sends a bounded project tree as model-visible custom message context, plus a `pi-internals` tool that agents can call on demand to print Pi runtime/source/settings/enabled-extension paths.

To let the owned scaffold replace Pi's built-in base prompt, create `~/.pi/agent/SYSTEM.md` containing exactly:

```md
You are an expert coding assistant operating inside pi, a coding agent harness.
```

See `pi-extensions/system-prompt/README.md` for the merged prompt-layer extension, `pi-extensions/system-prompt/owned-system-prompt/README.md` for scaffold-ownership details, and `pi-extensions/tools/pi-internals/README.md` for Pi internals discovery.

## Bundled agents

- `pi-agents/scout.md` — fast codebase recon and architecture mapping
- `pi-agents/fixer.md` — validation repair and scoped mechanical completion agent
- `pi-agents/hack.md` — shell-first investigation and automation agent
- `pi-agents/review.md` — faster/cheaper single-agent code review for spot checks
- `pi-agents/deep-review/` — multi-role review for a full feature, PR, or session workload; pass commits/diff, PRD/spec/task files, relevant paths, intent, risks, validation results, and any upfront exploration notes so each reviewer starts with shared hot context
- `pi-agents/council/` — multi-role ideation panel for non-trivial decisions where the main agent wants another opinion before reporting back; includes skeptic, evidence scout, simplifier, and scope guard; pass proposed direction, intended outcome, problem, tradeoff/decision, relevant files/specs/code paths, constraints, risks, rejected options, and desired help

## Included skills

- `skills/afk-create-tasks/SKILL.md` — create deterministic AFK task files from planning context
- `skills/git-commit/SKILL.md` — create conventional git commit(s) from the current worktree changes
- `skills/git-merge/SKILL.md` — squash-merge a branch or linked worktree into the current branch, then clean up the source branch/worktree
- `skills/pi-session-introspection/SKILL.md` — jq cookbook for analysing Pi agent/subagent session JSONL files
- `skills/robustness/SKILL.md` — guidance for robust-enough edge-case and failure-mode handling
- `skills/skill-authoring/SKILL.md` — guide for writing well-structured Pi skills
- `skills/spec-authoring/SKILL.md` — guide for turning feature intent into implementation-ready specs
- `skills/writing-tests/SKILL.md` — guidance for deciding whether and how to write tests

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

# agents

Pi-specific agent tooling extracted from my dotfiles repo. Still need to port more of the old [claude stuff](https://github.com/codethread/claude-code-plugins).

## Contents

- `pi-extensions/` — Pi extensions grouped into `tools/`, `ui/`, `context-management/`, `system-prompt/`, `messages/`, and `system/`
- `pi-agents/` — bundled subagents used by the `subagent` extension
- `prompts/` — prompt templates
- `pi-themes/` — Pi themes
- `skills/` — reusable Pi skills

**Note on Cache Invalidation:** When working with dynamic context injections and extensions, understand that modifying the system prompt mid-session (or changing the model/provider) completely drops the LLM Prompt Cache. This forces the entire conversation prefix to be reprocessed, increasing latency and cost. Ensure this is a mindful tradeoff in your extension design. See `specs/notes--discovery.md` for detailed cache management and "Lost in the Middle" attention strategies.

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

This package ships a merged `system-prompt` extension that:

- owns the base prompt scaffold after custom `SYSTEM.md` setup
- injects global/project `agent.njk` rules
- appends a bounded project-structure snapshot

It also ships a `pi-discovery` context-management extension that adds a one-shot Pi runtime/extension discovery note when the user explicitly mentions `Pi`.

To let the owned scaffold replace Pi's built-in base prompt, create `~/.pi/agent/SYSTEM.md` containing exactly:

```md
You are an expert coding assistant operating inside pi, a coding agent harness.
```

See `pi-extensions/system-prompt/README.md` for the merged prompt-layer extension, `pi-extensions/system-prompt/owned-system-prompt/README.md` for scaffold-ownership details, and `pi-extensions/context-management/pi-discovery/README.md` for Pi-aware context injection.

## Bundled agents

- `pi-agents/scout.md` — fast codebase recon and architecture mapping
- `pi-agents/fixer.md` — validation repair and scoped mechanical completion agent
- `pi-agents/hack.md` — shell-first investigation and automation agent

## Included skills

- `skills/git-commit/SKILL.md` — create conventional git commit(s) from the current worktree changes
- `skills/git-merge/SKILL.md` — squash-merge a branch or linked worktree into the current branch with an inferred semantic commit message, preserve a concise source commit list in the body, then clean up the source branch/worktree
- `skills/pi-session-introspection/SKILL.md` — jq cookbook for analysing Pi agent/subagent session JSONL files (tool usage, thinking, costs, file ops, subagent manifests)
- `skills/skill-authoring/SKILL.md` — guide for writing well-structured Pi skills
- `skills/spec-authoring/SKILL.md` — guide for turning feature intent into implementation-ready specs

## Development

The Vitest suite includes both unit/snapshot tests and Pi runtime integration tests backed by `@marcfargas/pi-test-harness`.

```bash
pnpm install
pnpm format
pnpm lint
pnpm typecheck
pnpm check
```

Running `pi` from this repo works for local testing because `.pi/settings.json` points Pi at the package root.

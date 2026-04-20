# agents

Pi-specific agent tooling extracted from my dotfiles repo. Still need to port more of the old [claude stuff](https://github.com/codethread/claude-code-plugins).

## Contents

- `pi-extensions/extensions/` — Pi extensions, including tools like `subagent` and `questionnaire`
- `pi-agents/` — bundled subagents used by the `subagent` extension
- `pi-extensions/prompts/` — prompt templates
- `pi-extensions/themes/` — Pi themes
- `skills/` — reusable Pi skills

**Note on Cache Invalidation:** When working with dynamic context injections and extensions, understand that modifying the system prompt mid-session (or changing the model/provider) completely drops the LLM Prompt Cache. This forces the entire conversation prefix to be reprocessed, increasing latency and cost. Ensure this is a mindful tradeoff in your extension design. See `specs/discovery.md` for detailed cache management and "Lost in the Middle" attention strategies.

## Install as a Pi package

From a local checkout:

```bash
pi install /absolute/path/to/agents
```

From git later:

```bash
pi install git:github.com/<you>/agents
```

Pi loads the package's extensions, prompts, themes, and skills through `package.json#pi`.
The bundled agents are discovered by the `subagent` extension from `pi-agents/`, so they travel with the package too. Project-specific agents still load from the nearest `.pi/agents/` directory when you run Pi inside another repo. The package also includes a `pi-discovery` extension that watches for explicit `Pi` mentions and appends Pi runtime source paths plus currently discovered extension source paths as a one-shot contextual note on the triggering user message, helping Pi inspect installed implementations directly when users reference them.

This package also ships an `owned-system-prompt` extension. To let it replace Pi's built-in base prompt scaffold, create `~/.pi/agent/SYSTEM.md` containing exactly:

```md
You are an expert coding assistant operating inside pi, a coding agent harness.
```

See `pi-extensions/extensions/owned-system-prompt/README.md` for details.

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

```bash
pnpm install
pnpm format
pnpm lint
pnpm typecheck
pnpm check
```

Running `pi` from this repo works for local testing because `.pi/settings.json` points Pi at the package root.

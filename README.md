# agents

Pi-specific agent tooling extracted from my dotfiles repo.

## Contents

- `pi-extensions/extensions/` — Pi extensions
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
The bundled agents are discovered by the `subagent` extension from `pi-agents/`, so they travel with the package too. Project-specific agents still load from the nearest `.pi/agents/` directory when you run Pi inside another repo. You can also talk to one discovered agent directly with `pi --agent <name>`, which inherits that agent file's runtime config into the top-level Pi session: prompt body, model/thinking, and tool selection all come from the agent file unless explicit CLI flags override those fields. The package also includes a `pi-discovery` extension that watches for explicit `Pi` mentions and appends currently discovered extension source paths as a one-shot contextual note on the triggering user message, helping Pi inspect installed extension implementations directly when users reference them.

## Bundled agents

- `pi-agents/scout.md` — fast codebase recon and architecture mapping
- `pi-agents/builder.md` — scoped implementation agent for code/config changes
- `pi-agents/hack.md` — shell-first investigation and automation agent

## Included skills

- `skills/skill-authoring/SKILL.md` — guide for writing well-structured Pi skills
- `skills/pi-session-introspection/SKILL.md` — jq cookbook for analysing Pi agent/subagent session JSONL files (tool usage, thinking, costs, file ops, subagent manifests)
- `skills/merge/SKILL.md` — squash-merge a branch or linked worktree into the current branch with an inferred semantic commit message, preserve a concise source commit list in the body, then clean up the source branch/worktree

## Development

```bash
pnpm install
pnpm format
pnpm lint
pnpm typecheck
pnpm check
```

Running `pi` from this repo works for local testing because `.pi/settings.json` points Pi at the package root.

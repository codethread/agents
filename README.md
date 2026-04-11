# agents

Pi-specific agent tooling extracted from my dotfiles repo.

## Contents

- `pi-extensions/extensions/` — Pi extensions
- `pi-extensions/agents/` — bundled subagents used by the `subagent` extension
- `pi-extensions/prompts/` — prompt templates
- `pi-extensions/themes/` — Pi themes

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

Pi loads the package's extensions, prompts, and themes through `package.json#pi`.
The bundled agents are discovered by the `subagent` extension from `pi-extensions/agents/`, so they travel with the package too. The package also includes a `pi-discovery` extension that watches for explicit `Pi` mentions and appends currently discovered extension source paths as a one-shot contextual note on the triggering user message, helping Pi inspect installed extension implementations directly when users reference them.

## Development

```bash
npm install
npm run format
npm run lint
npm run typecheck
npm run check
```

Running `pi` from this repo works for local testing because `.pi/settings.json` points Pi at the package root.

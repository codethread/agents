# agents

Skills and [pi](https://pi.dev/) stuff, still need to port most of [claude stuff](https://github.com/codethread/claude-code-plugins)

## Contents

- `pi-extensions/extensions/` — Pi extensions
- `pi-agents/` — bundled subagents used by the `subagent` extension
- `pi-extensions/prompts/` — prompt templates
- `pi-extensions/themes/` — Pi themes
- `skills/` — reusable Pi skills

## Development

```bash
pnpm install
pnpm format
pnpm lint
pnpm typecheck
pnpm check
```

Running `pi` from this repo works for local testing because `.pi/settings.json` points Pi at the package root.

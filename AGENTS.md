# AGENTS.md

- Install deps: `pnpm install`
- Format: automatic via `pnpm check` after all work completed
- Lint: `pnpm lint` (eslint)
- Test: `pnpm test` (vitest run)
- Typecheck: `pnpm typecheck` (tsc)
- Verify all checks: `pnpm check` when work complete, runs `lint` -> `typecheck` -> `build` -> `test` -> `format` (via prettier).
- When building extensions:
- For local Pi testing, run `pi` from this repo root, e.g;
- `pi --model deepseek/deepseek-flash:low --print ping`: run with a small model and get back a result
- `pi --no-extensions -e .` disable all extensions but load just the extensions in this repo for isolated testing
- Always verify extension changes/additions in a fresh `pi` process through the `interactive_shell` tool; do not trust current-session tool bindings after `/reload` for validation.
- Always keep the README.md files up-to-date for changes

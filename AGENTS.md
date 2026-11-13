# AGENTS.md

- Bootstrap from the repository root with `mise run` after installing and trusting mise. It installs root pnpm dependencies, the separate `.botlake` Bun dependencies, generated Skillbox copies, and local hooks; it does not start the lake or a server.
- Format: automatic via `pnpm check` after all work completed.
- Lint: `pnpm lint` (ESLint; includes `.botlake`).
- Test: `pnpm test` (Vitest).
- Typecheck: `pnpm typecheck` (includes `.botlake` and project scripts; keep `exactOptionalPropertyTypes` enabled for Botlake Core inference).
- Verify all checks: `pnpm check` runs lint -> typecheck -> tests -> format (Prettier) -> changelog sync.
- Query the recorded package history with `pnpm changelog`; regenerate or verify `CHANGELOG.md` with `pnpm changelog:generate` / `pnpm changelog:check`.
- When building extensions:
- For local Pi testing, run `pi` from this repo root, e.g;
- `pi --model deepseek/deepseek-flash:low --print ping`: run with a small model and get back a result
- `pi --no-extensions -e .` disable all extensions but load just the extensions in this repo for isolated testing
- Always verify extension changes/additions in a fresh `pi` process through the `interactive_shell` tool; do not trust current-session tool bindings after `/reload` for validation.
- Always keep the README.md files up-to-date for changes

# AGENTS.md

- Bootstrap from the repository root with `mise run` after installing and trusting mise. It installs all Bun workspace dependencies, generated Skillbox copies, and local hooks; it does not start the lake or a server.
- Format: automatic via `bun run check` after all work completed.
- Lint: `bun run lint` (ESLint; includes `.botlake`).
- Test: `bun run test` (Vitest).
- Typecheck: `bun run typecheck` (includes `.botlake` and project scripts; keep `exactOptionalPropertyTypes` enabled for Botlake Core inference).
- Verify all checks: `bun run check` runs lint -> typecheck -> tests -> format (Prettier) -> changelog sync.
- Query the recorded package history with `bun run changelog`; regenerate or verify `CHANGELOG.md` with `bun run changelog:generate` / `bun run changelog:check`.
- When building extensions:
- For local Pi testing, run `pi` from this repo root, e.g;
- `pi --model deepseek/deepseek-flash:low --print ping`: run with a small model and get back a result
- `pi --no-extensions -e .` disable all extensions but load just the extensions in this repo for isolated testing
- Always verify extension changes/additions in a fresh `pi` process through the `interactive_shell` tool; do not trust current-session tool bindings after `/reload` for validation.
- Always keep the README.md files up-to-date for changes

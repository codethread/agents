# AGENTS.md

Never stop the mill; only the user may stop it.

- Install deps: `pnpm install`
- Format: automatic via `pnpm check` after all work completed
- Lint: `pnpm lint` (eslint)
- Test: `pnpm test` (vitest run)
- Typecheck: `pnpm typecheck` (tsc)
- Verify all checks: `pnpm check` when work complete, runs `lint` -> `typecheck` -> `build` -> `test` -> `format` (via prettier).
- When building extensions:
  - always add `--debug-*` flags to allow you to verify results, see ./pi/extensions/system-prompt/index.ts as an example
  - extensions exposing `/debug-*` commands should use `./pi/extensions/components/debug-message/index.ts` for hidden debug output so the UI stays consistent (`Ctrl+G` open in editor, `Ctrl+Enter` send to agent)
  - when an extension adds new CLI flags, add them to `scripts/pi.nu` under the extension flags comment with an `[EXT]` prefix in the comment string
  - For local Pi testing, run `pi` from this repo root, e.g;
    - `pi --model deepseek/deepseek-flash:low --print ping`: run with a small model and get back a result
    - `pi --no-extensions -e .` disable all extensions but load just the extensions in this repo for isolated testing
  - Always verify extension changes/additions in a fresh `pi` process through the `interactive_shell` tool; do not trust current-session tool bindings after `/reload` for validation.
- Always keep the README.md files up-to-date for changes

## writing prompts / skills

Keep skill intent and design rationale in `docs/skills/<skill-name>.md`, one file per skill. Before changing a skill, read its intent document and preserve that intent; update the document when intent deliberately changes. Create the document when adding a skill or when changing a skill that has none. Keep maintainer metadata out of `SKILL.md`; operational guidance belongs in the skill itself.

Always write prompts and skills as literal messages the agent will receive. The agent cannot tell whether text came from a user typing, a slash prompt, or a script.

Keep prompts self-contained, or reference only things the receiving agent definitely has access to.

Good:

- "Load `plugins/coding/skills/robustness/SKILL.md` before handling edge cases."
- "Use the `review` subagent for a focused code review."
- "Use the `read` tool to inspect the selected files."
- "Complete the selected task slice included below."

Bad:

- "The loop already selected this using `plugins/devflow/scripts/devflow/mod.nu`."
- "Continue from the previous `/afk` prompt."
- "Follow the workflow from the skill that generated this prompt."
- "Use state from the script/session that invoked you."

If orchestration code performs work before sending a prompt, describe the result, not the orchestrator: say "selected task" rather than "task selected by scripts/foo.nu".

## Hive workflow

Use Hive for new repository work. Read `beeswax prime` and `.agents/skills/hive/SKILL.md`; installed CLI guidance owns tool procedures. Setup and migration evidence are in `.hive/README.md`.

The authorized migration imported and verified all 55 work records. Source captures and mapping evidence remain in `.hive/migrations/`; imported historical instructions do not grant new execution or publication authority.

- Run `beeswax sync` after installing the matching Hive release and trusting repository hooks. Confirm the selected tracker with `beeswax beads env --json`; preserve supplied `BEADS_DB` and `BD_ACTOR`. Without an actor, use the Scent identity delivered by onboarding rather than another worker's identity.
- For direct shell/Pi sessions, use the setup-generated Mise environment (`mise exec -- br where --json` verifies selection; `mise exec -- pi` launches Pi). Without `BEADS_DB`, native `br` can select an unrelated home tracker. Managed bees already inherit their selected database; preserve it.
- Accountable human owner: `ct`. Ownership is not assignment; do not assign human work without explicit instruction.
- Use `br` for task authority, `bee` for delegation, and Honeycomb for worktrees. The configured kinds are in `.hive/bees.toml`; inspect with `bee kinds`. Repository-wide checks run through `qlock exec --lock /tmp/agent-cpu.lock -w 180 -- pnpm check`.
- Keep `.worktrees/tracker--state` out of feature cleanup and application checks. Never merge `tracker/state` into application branches.
- Tracker edits stay local until an explicitly authorized publication checkpoint. Commit permission alone does not authorize a push, `beeswax beads sync`, or Honeycomb's inherited push-on-finish behavior.
- Preserve `.millstrand/` and the running mill as legacy evidence. Do not feed new work to both schedulers. Migration does not transfer old claims, agent sessions, or running workflows; package-owned Millstrand identity integration remains unchanged for consumers.
- For another board import or reconciliation, load `.agents/skills/millstrand-to-beads/SKILL.md`.

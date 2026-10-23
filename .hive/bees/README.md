# Bee kinds

`.hive/bees.toml` is canonical: 19 kinds comprising nine available Millstrand aliases, three reviewer lenses, and seven Pi roles. All repository delegation uses Bee, not Pi's subagent tool.

## Available Millstrand aliases

| Kind       | Effective model              | Effort | Inheritance / access                                      |
| ---------- | ---------------------------- | ------ | --------------------------------------------------------- |
| `astra`    | `openai-codex/gpt-6-astra`   | high   | direct                                                    |
| `deepseek` | `deepseek/deepseek-flash`    | max    | `allow = ["oracle", "reviewer"]`                          |
| `grunt`    | `deepseek/deepseek-flash`    | max    | selected `deepseek` candidate; same `allow`               |
| `luna`     | `openai-codex/gpt-5.6-luna`  | xhigh  | direct; `allow = ["oracle", "reviewer"]`                  |
| `oracle`   | `openai-codex/gpt-6-astra`   | high   | selected `astra` candidate                                |
| `reviewer` | `openai-codex/gpt-5.6-terra` | high   | selected `terra` candidate; `allow = ["grunt", "oracle"]` |
| `sol`      | `openai-codex/gpt-5.6-sol`   | low    | direct                                                    |
| `terra`    | `openai-codex/gpt-5.6-terra` | high   | direct                                                    |
| `tui`      | `openai-codex/gpt-5.6-sol`   | low    | selected `sol` candidate                                  |

Models, efforts, descriptions, and `allow` values reflect selected candidates and inherited parents; no blanket model upgrades were applied. The source marks `deepseek` available with a `seat/allow-china` condition, which Hive kinds cannot express. This snapshot enables the available selection; revisit it if source availability changes.

These unavailable aliases remain pending and are not configured as kinds:

- `fable` and `opus`: their Claude harness is unavailable.
- `grok`: its Cursor harness is unavailable.

## Reviewer lenses

Each kind's `system_prompt` retains the original reviewer prompt and remit, preceded by the Bee-delegation instruction. Source-form also retains its separate judgment-focused system prompt. All lenses use the selected `grunt` seat (`deepseek/deepseek-flash`, `max`).

| Kind                         | Source reviewer       | Path scope                                                                                               | Source labels                  |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `review-docs-and-tests`      | `docs-and-tests`      | `README.md`, `docs/**`, `src/**`, `test/**`, `spools/*/README.md`, `spools/*/src/**`, `spools/*/test/**` | `PR`, `Docs`, `Tests`          |
| `review-runtime-correctness` | `runtime-correctness` | `src/**`, `spools/*/src/**`                                                                              | `PR`, `Correctness`, `Clojure` |
| `review-source-form`         | `source-form`         | `src/**`, `spools/*/src/**`                                                                              | `PR`, `Clojure`, `Readability` |

Hive kinds cannot configure path globs or reviewer-label selectors. The table records source selection boundaries for callers; it does not enforce them. Reviewer adapters include Bash only for Bee tracker/run reporting. Reviewers must not edit application files; instructions are not a filesystem sandbox.

## Existing Pi agents

These kinds invoke Pi's native `--agent`. Most reuse existing definitions; review, research, and prose adapters retain the original role instructions and add Bee completion tools. Model and effort use each role's non-`~/pb/**` selection.

| Kind     | Existing definition   | Model                              | Effort |
| -------- | --------------------- | ---------------------------------- | ------ |
| `worker` | `agents/worker.md`    | `openai-codex/gpt-6-luna`          | max    |
| `scout`  | `agents/scout.md`     | `openai-codex/gpt-6-luna`          | high   |
| `fixer`  | `agents/fixer.md`     | `openai-codex/gpt-5.3-codex-spark` | low    |
| `hack`   | `agents/hack.md`      | `openai-codex/gpt-6-luna`          | xhigh  |
| `review` | `agents/review.md`    | `openai-codex/gpt-6-luna`          | max    |
| `nerd`   | `agents/nerd.md`      | `openai-codex/gpt-6-luna`          | xhigh  |
| `prose`  | `.pi/agents/prose.md` | `openai-codex/gpt-6-astra`         | high   |

Native Pi runs as `~/.pi/agent/bin/pi`, bypassing Pies. Managed calls use headless JSON output and `--approve`. Hidden `.pi/agents/bee-{review,nerd,prose}.md` adapters include reporting tools. Research retains Context7: CLI `--tools` overrides skip agent-local MCP registration, so formulas do not use them. Prose's original definition has no explicit tools; its adapter supplies read/edit/write/Bash. Keep adapters aligned with original tool or MCP declarations.

Scout, research, and review roles may write required tracker reports but must leave application files unchanged. Other roles retain their original editing scope. `allow` lists guide Bee discovery, not execution authorization.

## Execution policy

Managed attempts do not retry automatically (`max_retries = 0`). Capacity limits are four colony-wide, two per kind, and two per worktree. The configured human owner is `ct`.

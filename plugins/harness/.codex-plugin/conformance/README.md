# Codex startup-hook conformance fixtures

This suite pins the startup-hook boundary used by the future Codex identity adapter. It targets **Codex CLI 0.154.0** and runs only against disposable home, config, state, cache, temp, and process-cwd directories. Only `PATH` is inherited; credentials, `MILLSTRAND_*` variables, shell startup scripts, and ambient fixture settings are excluded. It does not call a model, a real Strand identity API, a shared Millstrand workspace, or any desktop application.

Requires Node.js, Bash, `jq`, and the pinned Codex executable on `PATH`. Run it from the repository root:

```text
pnpm test:codex-hooks
```

The command fails when `codex --version` is not exactly `codex-cli 0.154.0`. Updating that pin requires reviewing the selected release's generated hook schemas and re-running every fixture; current documentation can describe behavior newer than the installed CLI.

## Pinned input contract

The sanitized payloads reproduce the required fields in the `rust-v0.154.0` generated schemas:

| Event           | Event-specific fields used by the adapter                                                 |
| --------------- | ----------------------------------------------------------------------------------------- |
| `SessionStart`  | `session_id`, `cwd`, and `source`; `source` is `startup`, `resume`, `clear`, or `compact` |
| `SubagentStart` | parent `session_id`, `cwd`, `turn_id`, `agent_id`, and `agent_type`                       |

Both payloads also carry `transcript_path`, `model`, `permission_mode`, and the literal `hook_event_name`. `SubagentStart` has no `source` field in 0.154.0. The future adapter must key a child with the parent `session_id` plus `agent_id`; it must not treat the parent session ID alone as the child's identity key.

The four generated input/output schemas are vendored under `schemas/` from OpenAI Codex tag `rust-v0.154.0` (commit `6b9826e3aa`). The runner validates each fixture and reference response against those pinned properties, required fields, constants, enums, and types.

Fixtures:

- `payloads/session-start-startup.json`
- `payloads/session-start-resume.json`
- `payloads/session-start-clear.json`
- `payloads/session-start-compact.json`
- `payloads/subagent-start.json`

The startup fixture uses a sanitized linked-worktree path. The fake preserves that exact payload cwd and maps it to the owning workspace, proving the adapter boundary routes from the event cwd rather than the plugin process directory. Real Git-worktree discovery remains an identity-adapter/live-API acceptance case.

## Pinned response contract

The adapter command must write exactly one JSON object to stdout:

```json
{
	"hookSpecificOutput": {
		"hookEventName": "SessionStart",
		"additionalContext": "..."
	}
}
```

For a child, `hookEventName` is `SubagentStart`. In Codex 0.154.0, `additionalContext` is **extra developer context** for the root session or child. It is not a replacement system prompt. `systemMessage` is a UI/event-stream warning and is not model context.

Plain stdout is also developer context for these two events, but the identity adapter contract deliberately requires the explicit JSON channel so output can be validated and warnings stay distinct. A successful response must keep required identity guidance concise and complete.

Codex spills model-visible hook output above an approximate 2,500-token default: it saves the full text and gives the model a head-and-tail preview. A command's `additionalContextLimit` can select another threshold, while `0` disables spilling. Required identity or policy must not silently become a spill preview. The reference fixture therefore declines to return oversized required context and instead returns a bounded `systemMessage`; the disposable CLI duplicate fixture also verifies that 0.154.0 exposes the configured limit in `hooks/list` metadata. A production adapter must select and enforce its reviewed byte/token budget before returning `additionalContext`.

## What the suite proves

`run.mjs` performs two bounded layers:

1. It replays every payload through `reference-hook.sh`. `fake-strand.sh` records normalized event values and returns deterministic, fixture-only identity text. This checks startup/resume/clear/compact, the child discriminator, fixture-runner scrubbing of seeded identity/run/bootstrap/reservation/workspace variables (including empty values), fixture-declared unmanaged state, linked-worktree cwd routing, verbatim context forwarding, event-specific JSON output, oversized context handling, bounded nonzero/malformed/empty/multiple/flooding Strand responses, capture-file cleanup, and forced-timeout cleanup. This proves an unmanaged test environment, not production-adapter scrubbing or real identity binding.
2. It starts Codex app-server 0.154.0 in disposable configurations and calls `hooks/list`. This checks the plugin manifest's explicit `.codex-plugin/hooks/hooks.json` discovery, untrusted and trusted states, hooks-feature disablement, plugin disablement, a missing hook file warning, multiple matching registrations, and `additionalContextLimit` metadata.

The fake's stdin format is private test scaffolding. It does **not** finalize the Millhouse/Strand identity command name, arguments, or response schema. The adapter may replace the reference command while continuing to consume these Codex payload and output fixtures.

Codex runs matching hooks from all active sources, commonly concurrently. The suite verifies that duplicate SessionStart registrations remain visible in discovery; it does not install an injector or implement duplicate rejection. The adapter must diagnose duplicate injectors as a configuration error. Identity-binding idempotency cannot prevent duplicate context injection.

## Desktop-intended contract and validation limit

OpenAI's official plugin packaging documentation says repo plugin enablement applies to supported local clients, including Codex CLI and Codex in the ChatGPT desktop app. It also says enabled plugins can provide lifecycle hooks, defaults discovery to `hooks/hooks.json`, permits a compatibility manifest's explicit `hooks` path, and requires hook scripts to exist in the execution environment. Installing or enabling a plugin does not grant hook trust.

Those documents establish the intended desktop packaging contract. **No live desktop application, plugin, or conversation was opened, closed, restarted, reloaded, or otherwise exercised for this suite.** Desktop execution is therefore not certified and is not a runtime gate.

The no-model CLI fixture proves discovery metadata and validates reference-command output separately; the packaged production hook remains observational dialogue capture. It does not prove hook execution, host trust enforcement, spilling, or delivery to a model. Developer-role delivery and spill behavior are also grounded in the pinned source (`core/src/context/hook_additional_context.rs`, `hooks/src/events/session_start.rs`, and `hooks/src/output_spill.rs`, under `codex-rs/`). Later CLI-only adapter acceptance with a real model must demonstrate that startup/resume and child requests receive the developer context, alongside live routing and negative host cases. That later evidence must not be inferred from fake Strand output or successful process exit.

Official references:

- <https://developers.openai.com/codex/hooks/>
- <https://developers.openai.com/plugins/build/plugins/>
- Exact inspected source: OpenAI Codex tag `rust-v0.154.0`, commit `6b9826e3aa`, generated `session-start` and `subagent-start` command schemas

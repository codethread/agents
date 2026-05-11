# Task 2: Enforce startup model validation

## Scope

Type: AFK

Wire parsed model candidates into startup and direct `--agent` behavior. This slice should make declared model policy fail loudly during Pi startup when invalid for the active runtime, and should make direct `pi --agent <name>` select the first valid candidate when no CLI model/provider override is present.

## Must implement exactly

- Add a model-policy validation helper that can validate discovered agents against Pi's active model registry/resolution surface.
- Treat known missing API key/auth availability from Pi model selection as invalid for startup/direct mode.
- During normal startup/session initialization, aggregate per-agent model-policy errors from the discovery snapshot and fail Pi init if any discovered agent that declares model policy has no valid candidate or has a config error.
- Preserve omitted `model` as normal inheritance.
- Keep startup validation behavior explicit for user-home agents: if discovery includes a user agent with declared invalid model policy, that is a startup config error, not a silent skip.
- After enabling strict startup validation, run a repo-root Pi startup smoke check. If ambient user-home agent config now blocks startup and the fix is outside this repo, mark this task `BLOCKED` with the exact offending path/reason instead of weakening strict validation.
- Before enabling strict startup validation, make repo-controlled bundled agents safe under that rule: do not leave bundled agent files with provider-specific declared model policy that would require credentials unrelated to the active default environment. Prefer omitting `model` for bundled agents unless this slice can define a deterministic valid model policy without inventing provider choices.
- For direct `--agent <name>`:
  - use the first valid candidate when model/provider CLI override is absent
  - apply explicit thinking only when that selected candidate includes a thinking suffix
  - keep `--model`, `-m`, or `--provider` as authoritative overrides that suppress model-policy application for the selected agent
  - keep `--thinking` as authoritative over inherited candidate thinking
  - fail loudly if the selected candidate cannot be applied
- Keep error messages traceable: include agent name and source file path when available.
- Update direct-mode tests or add focused tests for validation and first-candidate selection.

## Done when

- A discovered agent with invalid declared model policy blocks startup with a clear error.
- A discovered agent with omitted `model` does not block startup for model-policy reasons.
- Direct `--agent` applies the first valid candidate and candidate-local thinking.
- Direct `--agent --model ...` does not apply agent-declared candidates.
- Bundled repo agents do not make normal startup depend on unrelated provider credentials.
- Repo-root Pi startup smoke check passes, or this task is marked `BLOCKED` with the ambient user-home config path/reason.
- Relevant validation passes: targeted subagent tests plus the repo's required full verification command.
- Relevant README/spec text for startup/direct-mode behavior is updated in the same slice.

## Out of scope

- Runtime-scoped hot-reload behavior for `subagent` tool calls.
- Launching delegated children with explicit candidates.
- Model-chain retry/advance behavior.
- Session/render metadata.

## References

- `specs/subagent--dynamic-model-selection.md`
- `pi-extensions/tools/subagent/index.ts`
- `pi-extensions/tools/subagent/agents.ts`
- `pi-extensions/tools/subagent/index.test.ts`
- `skills/robustness/SKILL.md`

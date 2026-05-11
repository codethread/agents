# AFK Plan: Subagent Dynamic Model Selection

## Problem statement / MVP goal

Implement Pi-native dynamic model selection for subagents. Agent markdown keeps one public `model` field that may be omitted, a string, a gated object, or an ordered list of strings/objects. Declared model policy is validated loudly, environment-gated at discovery time, and used by delegated subagent execution to try ordered candidates transparently to the calling agent.

MVP excludes any second model-list field, shell-backed condition evaluation, broad expression syntax, per-call model overrides, and top-level `pi --agent` generation retry after the main session starts.

## Important references

- `specs/subagent--dynamic-model-selection.md` — planned behavior and decisions.
- `specs/subagent--discovery-and-config.md` — current discovery/config boundary.
- `specs/subagent--orchestration.md` — current runtime/session/rendering boundary.
- `pi-extensions/tools/subagent/agents.ts` — agent parsing, config normalization, runtime setting helpers.
- `pi-extensions/tools/subagent/index.ts` — extension entrypoint, `--agent`, `/debug-agents`, tool execution.
- `pi-extensions/tools/subagent/runtime.ts` — child Pi invocation and result capture.
- `pi-extensions/tools/subagent/types.ts` — runtime result shapes.
- `pi-extensions/tools/subagent/session.ts` — manifest persistence.
- `pi-extensions/tools/subagent/render.ts` — parent-visible output and TUI rendering.
- `pi-extensions/tools/subagent/README.md` — user-facing extension docs.
- `skills/robustness/SKILL.md` — required before implementing validation, retry, and failure behavior.

## Task strategy

All slices are AFK. The design decisions needed for unattended execution are captured in the spec and task files, so no HITL slice is needed.

The plan builds one narrow vertical path at a time:

1. Parse and normalize `model` policy safely at the discovery boundary.
2. Enforce strict startup/direct-mode validation and first-candidate direct selection.
3. Make runtime validation scoped to the requested target so hot-reloaded unrelated config does not kill useful work.
4. Launch delegated children with explicit selected candidates while preserving omitted-model inheritance.
5. Add the model-chain attempt loop and provider-failure classification.
6. Expose compact operational metadata and update docs/specs.

Each task should run the relevant tests it touches plus the repo's required full verification before marking complete. If the project-rule command and package script names differ, run the available full verification script and append the discrepancy to Developer Notes.

## Developer Notes

Append notes here. Do not rewrite earlier notes.

### Task plan created — 2026-05-11

- This plan intentionally uses “model chain” / “candidate” vocabulary only. There is no second model-list field in scope.
- Runtime model-chain behavior should remain transparent to the calling agent; human/debug/session surfaces may show compact operational metadata.
- Keep `subagent` tool parameters unchanged for the MVP.
- Model-policy parsing should preserve per-agent errors so startup can fail globally while runtime hot reload can fail only the requested target/member.

### Task 1 implementation — 2026-05-11

- Discovery now parses `model` into `modelCandidates` while preserving `agent.model` as the first accepted candidate for existing runtime-setting helpers.
- Malformed declared model policy is stored per agent as `modelPolicyError`; strict startup/runtime enforcement remains for later slices.
- Extension-local Claude/OpenAI alias rewriting was removed from the subagent parsing path; model strings are passed through for Pi resolution later.
- Project rules mention `pnpm check`, but package scripts expose `pnpm verify`; `pnpm check` was unavailable, so full validation used `pnpm verify`.

### Task 2 implementation — 2026-05-11

- Startup now validates all discovered agent model policies against the active model registry and fails loudly with agent/source-path errors when declared policies are malformed or have no valid candidate.
- Direct `--agent` selection now uses the first registry-valid declared candidate unless `--model`, `-m`, or `--provider` suppresses agent model inheritance; candidate-local thinking is skipped when `--thinking` is explicit.
- Bundled repo agents omit `model` so normal startup does not require provider-specific credentials unrelated to the active environment.
- Repo-root startup smoke check passed with `pi --model openai/gpt-5.4-nano:low --print ping`; full validation used `pnpm verify`.

### Task 3 implementation — 2026-05-11

- Parent `subagent` execution now validates model policy only for the selected single target or selected swarm members, using the same `validateAgentModelPolicy` registry/auth checks as startup.
- Delegated child `PI_SUBAGENT=1 --agent <name>` startup validates only that selected agent so unrelated hot-reloaded invalid agents do not kill a valid runtime call.
- Invalid swarm members become member-level failed results; valid members still launch and preserve existing partial swarm success behavior.

### Task 4 implementation — 2026-05-11

- `runSingleAgent` now passes the first normalized model candidate into child argument construction; omitted `model` still produces the previous no-explicit-model invocation.
- Child args keep `--agent <name>` and add explicit `--model <modelRef>` plus `--thinking <level>` only when the selected candidate carries a recognized thinking suffix, which lets the child direct-agent path suppress recursive model-policy inheritance via the existing CLI override detection.
- Resume/session argument ordering and behavior are preserved for fresh, persisted, and resumed child sessions.
- Project rules mention `pnpm check`, but package scripts expose `pnpm verify`; full validation used `pnpm verify` after targeted runtime tests.
- Deep review caught that runtime should choose the first registry/auth-valid candidate, not the raw first normalized entry; `runSingleAgent` now receives the active model registry and uses the shared direct-mode selection helper.

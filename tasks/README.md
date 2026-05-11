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

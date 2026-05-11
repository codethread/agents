# Task 3: Scope runtime model validation

## Scope

Type: AFK

Make `subagent` tool execution validate model policy only for the requested runtime target. This slice protects hot reload: a broken unrelated agent should not prevent a selected valid subagent from running, while the selected single agent or swarm members still report clear model-policy failures.

## Must implement exactly

- In `subagent` tool execution, validate model policy for the requested single-agent target before launching it.
- If the requested single-agent target has invalid/no-valid declared model candidates at runtime, return a tool error with a clear message that includes the agent name and file path when available.
- For swarm runtime execution:
  - validate each member independently
  - run valid members normally
  - produce a member-level failure result for invalid members
  - preserve partial swarm success semantics when at least one member succeeds
- Ensure runtime-scoped validation consumes the same per-agent model-policy errors and model-registry semantics as startup validation, but applies them only to the requested single target or requested swarm members.
- Do not let unrelated invalid agents in the discovery snapshot block a runtime call to a valid requested target.
- Add tests for valid requested target with unrelated invalid agent, invalid requested single target, and mixed-validity swarm members.

## Done when

- Runtime hot-reload behavior is scoped to the requested target.
- Invalid selected single agent returns a clear `subagent <name> failed`-style tool error rather than crashing the whole process.
- Mixed-validity swarm returns valid member output plus invalid member error blocks.
- Existing swarm partial-failure behavior remains intact.
- Relevant validation passes: targeted subagent tool/runtime tests plus the repo's required full verification command.
- Relevant README/spec text for runtime-scoped hot-reload behavior is updated in the same slice.

## Out of scope

- Child process explicit model candidate launch.
- Model-chain retry/advance behavior.
- Startup strict validation changes beyond what Task 2 already implemented.
- Public tool schema changes.

## References

- `specs/subagent--dynamic-model-selection.md`
- `specs/subagent--orchestration.md`
- `pi-extensions/tools/subagent/index.ts`
- `pi-extensions/tools/subagent/types.ts`
- `pi-extensions/tools/subagent/render.ts`
- `skills/robustness/SKILL.md`

# Task 4: Run child with explicit candidates

## Scope

Type: AFK

Teach delegated child execution to run with an explicit selected model candidate when the agent declares model policy. This is the first runtime tracer bullet: one valid candidate should travel from markdown discovery through tool execution into the child Pi invocation, while omitted `model` still inherits/defaults as before.

## Must implement exactly

- Extend the runtime request/result path so `runSingleAgent` can receive one selected model candidate for a child attempt.
- When an agent has a model candidate, build child Pi args with explicit `--model` and explicit `--thinking` only when the candidate includes a thinking suffix.
- Keep `--agent <name>` in the child invocation so prompt and tool inheritance still come from the agent file.
- Ensure explicit child `--model` causes the child direct-agent inheritance path to suppress agent-declared model policy in the child process, avoiding recursive selection.
- When an agent omits `model`, keep the current child invocation behavior with no explicit `--model`/`--thinking` from this feature.
- Preserve resume/session args exactly as before for both fresh and resumed child sessions.
- Add tests for child argument construction with no candidate, model-only candidate, model-with-thinking candidate, and resumed session.

## Done when

- A delegated agent with one declared model candidate launches child Pi with that candidate explicitly.
- A delegated agent with omitted `model` launches as before.
- Candidate-local thinking is passed only when explicitly declared on that candidate.
- Existing resume/session behavior and tests remain green.
- Relevant validation passes: targeted runtime tests plus the repo's required full verification command.
- Relevant README/spec text for explicit delegated candidate launch behavior is updated in the same slice.

## Out of scope

- Multiple-candidate retry/advance loop.
- Provider error classification.
- Attempt metadata persistence/rendering.
- Public tool schema changes.

## References

- `specs/subagent--dynamic-model-selection.md`
- `pi-extensions/tools/subagent/runtime.ts`
- `pi-extensions/tools/subagent/agents.ts`
- `pi-extensions/tools/subagent/runtime.test.ts`
- `skills/robustness/SKILL.md`

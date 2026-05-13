# Task 5: Advance through model chain

## Scope

Type: AFK

Implement the delegated runtime model-chain attempt loop. This slice should make a subagent try ordered candidates transparently, retry transient provider failures up to three total attempts per candidate, advance immediately on deterministic provider/model availability failures, and stop immediately on context overflow.

## Must implement exactly

- Add a parent-runtime attempt loop around child Pi execution for agents with declared model candidates, including single-candidate policies.
- Use three total attempts per candidate for transient provider failures.
- Do not add retry backoff/delay.
- Classify context-window overflow using Pi's existing classifier where available; context overflow is terminal for the subagent call and must not advance to the next candidate.
- Treat deterministic provider/model availability failures as immediate advance to the next candidate without repeating the same candidate:
  - missing/invalid auth or API key
  - model unavailable/not found/gated
  - quota/funds exhausted
- Treat transient provider failures as retryable for the same candidate before advancing:
  - timeout/network interruption
  - provider rate limit/429
  - provider 5xx/overloaded/unavailable
- Do not classify task failures, tool failures, validation/test failures inside the child, aborted runs, or normal non-provider errors as model-chain failures.
- Preserve parent-visible response semantics:
  - success returns only the successful child output
  - terminal failure returns a clear subagent failure
  - the calling agent does not receive operational attempt chatter on success
- Add focused tests using the existing runtime test style for success on first candidate, transient retry then success, immediate advance, exhausted candidates, terminal context overflow, and non-provider failure.

## Done when

- Ordered candidates are attempted deterministically.
- Transient failures retry the same candidate up to three total attempts.
- Deterministic provider/model failures advance immediately.
- Context overflow returns a clear terminal subagent failure asking for reduced scope.
- Success remains transparent to the calling agent.
- Relevant validation passes: targeted runtime/tool tests plus the repo's required full verification command.
- Relevant README/spec text for retry, advance, and terminal context-overflow behavior is updated in the same slice.

## Out of scope

- Human-facing rendering of attempt summaries beyond what is required for clear terminal failure.
- Manifest schema updates for attempt metadata.
- Top-level direct `pi --agent` generation retry after startup.
- Public tool schema changes.

## References

- `specs/subagent--dynamic-model-selection.md`
- `pi-extensions/tools/subagent/runtime.ts`
- `pi-extensions/tools/subagent/render.ts`
- `pi-extensions/tools/subagent/types.ts`
- `node_modules/@earendil-works/pi-ai/dist/utils/overflow.d.ts`
- `skills/robustness/SKILL.md`

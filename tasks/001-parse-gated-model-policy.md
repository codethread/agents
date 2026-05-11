# Task 1: Parse gated model policy

## Scope

Type: AFK

Implement the discovery-boundary parsing path for the unified `model` frontmatter policy. This slice should make agent markdown capable of expressing omitted model inheritance, a single model string, a single gated model object, and ordered lists of strings/objects. It should also remove extension-local model alias rewriting from the parsing path.

## Must implement exactly

- Add safe parsing/evaluation for the v1 `when` grammar:
  - `$VAR`
  - `!$VAR`
  - `$VAR == "value"`
  - `$VAR != "value"`
  - single-quoted values as well as double-quoted values
- Use env truthiness where missing, empty, `false`, `0`, `no`, and `off` are false; false-like checks are case-insensitive.
- Ignore surrounding expression whitespace, but do not trim environment variable values before comparisons.
- Restrict env var names to `[A-Za-z_][A-Za-z0-9_]*`.
- Reject empty or unsupported `when` expressions with clear config errors.
- Support `model` frontmatter shapes:
  - omitted
  - non-empty string
  - non-empty list of strings and/or objects
  - object with `id` and optional `when`
- Detect model objects with unknown keys, missing/blank `id`, or invalid `when` as model-policy config errors.
- Detect `model: []` and present model policy that leaves no candidates after gating as model-policy config errors.
- Represent model-policy config errors per agent rather than aborting the whole discovery snapshot unconditionally, so later slices can choose strict startup validation or runtime target-scoped validation.
- Normalize accepted entries into an ordered internal candidate list that preserves first occurrence and deduplicates candidates after parsing.
- Preserve current single-string behavior for existing agents via the shared runtime-setting helpers.
- Remove custom Claude/OpenAI model alias rewriting from this code path; rely on Pi model resolution later.

## Done when

- Existing single-string `model` frontmatter still yields the same first runtime model/thinking behavior, except no custom alias rewrite occurs.
- New tests cover string, object, mixed-list, gating true/false, equality/inequality, invalid expressions, unknown object keys, empty lists, all-gated-out lists, deduplication, and omitted model inheritance.
- Existing agent discovery tests pass after updating expectations away from alias rewriting.
- Relevant validation passes: targeted tests such as `pnpm test -- pi-extensions/tools/subagent/agents.test.ts` plus the repo's required full verification command.
- Relevant docs/specs touched by this parsing behavior are updated in the same slice.

## Out of scope

- Pi model registry validation.
- Child process retry/advance behavior.
- Session manifest/rendering changes.
- Public tool schema changes.

## References

- `specs/subagent--dynamic-model-selection.md`
- `pi-extensions/tools/subagent/agents.ts`
- `pi-extensions/tools/subagent/agents.test.ts`
- `skills/robustness/SKILL.md`

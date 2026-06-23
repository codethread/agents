# Subagent Dynamic Model Selection Specification

**Document ID:** `SPEC-004`

**Status:** Implemented
**Last Updated:** 2026-05-22
**Configuration identification:** `SPEC-004` prefixes section and point identifiers in this document. Existing human-readable numbering is preserved for migration traceability.

## SPEC-004.P1 1. Overview

### SPEC-004.P2 Purpose

Subagent model selection should be Pi-native, explicit, and environment-aware. Agent authors can declare one model or an ordered model chain in the existing `model` frontmatter field. Pi filters conditional entries at discovery time, validates the resulting candidates against the active model registry where possible, and lets delegated subagent runs advance through candidates when provider/model availability failures occur.

### SPEC-004.P3 Goals

- **SPEC-004.B1:** Keep one public config surface: `model`.
- **SPEC-004.B2:** Let `model` be omitted so the agent inherits the parent/default Pi model.
- **SPEC-004.B3:** Let `model` be a string, an ordered list of strings, an object, or an ordered list of objects.
- **SPEC-004.B4:** Support simple environment gates on model candidates using a safe expression subset.
- **SPEC-004.B5:** Fail loudly when declared model policy is malformed or produces no valid candidates.
- **SPEC-004.B6:** Validate declared candidates against Pi's normal model registry/resolution semantics.
- **SPEC-004.B7:** Let delegated subagent execution retry transient provider failures and advance through ordered candidates transparently to the calling agent.
- **SPEC-004.B8:** Preserve human/debug/session metadata about attempted candidates without exposing operational churn in the agent-visible response.

### SPEC-004.P4 Non-Goals

- **SPEC-004.B9:** Introducing any second model-list frontmatter field.
- **SPEC-004.B10:** Implementing a shell-backed condition language.
- **SPEC-004.B11:** Adding a general-purpose expression evaluator with `&&`, `||`, regexes, arithmetic, functions, or parentheses.
- **SPEC-004.B12:** Adding per-call model override parameters to the `subagent` tool.
- **SPEC-004.B13:** Retrying direct top-level `pi --agent <name>` generation after the main session has started.
- **SPEC-004.B14:** Using custom model-name alias rewrites in the subagent extension.
- **SPEC-004.B15:** Treating task/tool/test failures as model availability failures.

## SPEC-004.P5 2. Design Decisions

- **SPEC-004.D1 Decision:** The only public model-policy field is `model`.
  - **Rationale:** A single field avoids schema drift. A single string covers the current common case; a list covers ordered dynamic choice; objects add conditions only where needed.

- **SPEC-004.D2 Decision:** Omitted `model` means inherit parent/default Pi model, while present-but-empty or present-but-gated-out model policy fails loudly.
  - **Rationale:** Inheritance must be intentional and unambiguous. Once an author declares model policy, silently falling back to an inherited provider could violate work/home routing expectations.

- **SPEC-004.D3 Decision:** Model objects support only `id` and optional `when`.
  - **Rationale:** Unknown keys are more likely typos than future intent. Rejecting them at the config boundary keeps invalid states out of runtime execution.

- **SPEC-004.D4 Decision:** `when` is evaluated by a tiny in-repo parser, not `bash -c` and not a broad npm expression dependency.
  - **Rationale:** Agent markdown can come from project directories. Evaluating it as shell during Pi startup would be code execution. Existing npm expression libraries are either too broad or do not match the desired `$VAR` syntax closely enough.

- **SPEC-004.D5 Decision:** The first `when` grammar supports only `$VAR`, `!$VAR`, `$VAR == "value"`, and `$VAR != "value"`, with single- or double-quoted string literals.
  - **Rationale:** This is enough for profile/work-machine gates while avoiding precedence and mini-language design questions.

- **SPEC-004.D6 Decision:** Environment truthiness treats missing, empty, `false`, `0`, `no`, and `off` as false.
  - **Rationale:** This keeps `when: "!$IS_WORK"` ergonomic in shells such as Nushell where env vars are commonly set to a string value like `false` instead of being unset.

- **SPEC-004.D7 Decision:** Candidate strings use Pi's normal model matching semantics.
  - **Rationale:** The subagent extension should not maintain a parallel model naming layer. If Pi accepts a model string, the subagent config can use it; if Pi cannot resolve it, config validation should report that clearly.

- **SPEC-004.D8 Decision:** Remove custom model alias rewrites from the subagent config layer.
  - **Rationale:** Alias policy belongs in Pi's model system, not in this extension. Extension-local rewrites make behavior harder to predict and debug.

- **SPEC-004.D9 Decision:** Thinking level is candidate-local when included in a model suffix.
  - **Rationale:** A later candidate without an explicit thinking suffix should use Pi/global default thinking, not inherit the previous candidate's suffix.

- **SPEC-004.D10 Decision:** Delegated subagent runtime owns the model-chain attempt loop.
  - **Rationale:** The parent process can keep attempts transparent to the caller, aggregate metadata, choose the next candidate, and preserve one final result contract.

- **SPEC-004.D11 Decision:** Direct `pi --agent <name>` applies filtering and chooses the first valid candidate, but does not retry/advance after top-level generation starts.
  - **Rationale:** Extension startup can select an initial model, but cannot cleanly restart the main agent request after an API failure without deeper Pi lifecycle support.

- **SPEC-004.D12 Decision:** CLI model/provider overrides disable agent-declared model policy for direct `--agent` mode.
  - **Rationale:** Explicit CLI selection should be authoritative and should not unexpectedly advance to agent-authored candidates.

- **SPEC-004.D13 Decision:** Transient provider failures retry the same candidate up to three total attempts; deterministic availability failures advance immediately.
  - **Rationale:** Timeouts, 429s, and 5xxs can clear. Missing/invalid auth, unknown models, gated models, and quota/funds exhaustion are not fixed by repeating the same call.

- **SPEC-004.D14 Decision:** Context-window overflow is terminal for the subagent call.
  - **Rationale:** The right recovery is usually to narrow the delegated task. Trying more candidates can waste calls and still fail because the prompt is too large.

- **SPEC-004.D15 Decision:** Startup validation is strict, while runtime hot-reload validation is scoped to the requested target.
  - **Rationale:** Startup should reveal broken config early. Runtime should not let an unrelated hot-reloaded broken agent prevent a useful selected delegation.

- **SPEC-004.D16 Decision:** Runtime swarm execution can return per-member config failures alongside successful members.
  - **Rationale:** Partial specialist output can still be useful. A broken member should be visible as a member failure rather than preventing all useful work.

- **SPEC-004.D17 Decision:** Attempt details are operational metadata, not agent-visible content.
  - **Rationale:** The caller asked for a delegated answer, not model routing details. Humans and session inspection still need enough metadata to audit what happened.

## SPEC-004.P6 3. Architecture

### SPEC-004.P7 Frontmatter shapes

Valid `model` examples:

```yaml
model: openai/gpt-5:low
```

```yaml
model:
  - openai/gpt-5:low
  - deepseek/deepseek-v4:high
```

```yaml
model:
  id: deepseek/deepseek-v4:high
  when: "!$IS_WORK"
```

```yaml
model:
  - id: deepseek/deepseek-v4:high
    when: "!$IS_WORK"
  - id: openai/gpt-5.4-mini:low
```

Discovery normalizes all present shapes into an ordered internal candidate list. If `model` is omitted, no candidate list is produced and normal Pi inheritance applies. Model-policy parse, gate, and validation errors must be representable per agent so startup can aggregate them strictly while runtime target selection can report only the requested target/member error.

### SPEC-004.P8 Discovery/load flow

1. Parse agent markdown frontmatter.
2. Parse `model` at the config boundary into raw candidate entries.
3. Validate object keys and required string fields.
4. Evaluate each candidate's optional `when` expression against `process.env`.
5. Drop candidates whose `when` evaluates false.
6. Deduplicate remaining candidates by resolved candidate identity, preserving first occurrence.
7. Validate remaining candidates against Pi model resolution/availability where the extension has registry access.
8. If `model` was present and no valid candidates remain, startup/direct-mode validation reports a traceable model-policy error with agent name, file path, and reason.
9. Store normalized candidates or the per-agent model-policy error on `AgentConfig` for startup validation, runtime target-scoped validation, and debug surfaces.

### SPEC-004.P9 Delegated runtime flow

For a single-agent delegated run:

1. Resolve the target from the runtime discovery snapshot.
2. If the agent has no model candidates, invoke child Pi with inherited/default model behavior as today.
3. If the agent has candidates, run child Pi with `--agent <name>`, the first candidate's explicit `--model`, and explicit `--thinking` only when the candidate includes a thinking suffix. The explicit CLI model suppresses agent-declared model inheritance inside the child process, avoiding recursive selection.
4. Let child Pi and Pi's internal retry/compaction behavior finish first.
5. Classify the final child result.
6. On success, return the final displayable output and record attempt metadata.
7. On terminal non-model/task/tool failure, return that failure.
8. On context overflow, return a clear terminal subagent failure telling the parent agent to reduce scope.
9. On deterministic model/provider availability failure, advance to the next candidate.
10. On transient provider failure, retry the same candidate until three total attempts are exhausted, then advance.
11. If all candidates are exhausted, return one clear subagent failure with compact attempt summaries.

For swarms, each member follows the same single-agent model flow independently. Runtime-discovered invalid members produce member-level failures while valid members still run. Unrelated invalid agents in the same hot-reloaded discovery snapshot do not block the requested target.

### SPEC-004.P10 Error classification

Classification should prefer existing Pi utilities when available, especially Pi's context-overflow detector. Text matching for provider failures is acceptable only where Pi exposes no structured error code; classifiers should be narrow enough to avoid mistaking task/test/tool failures for model availability failures.

## SPEC-004.P11 4. Data Model

Internal concepts live in the subagent extension rather than in public tool parameters:

- **SPEC-004.B16:** normalized candidate: exact model flag value plus optional parsed thinking level
- **SPEC-004.B17:** agent config: optional ordered candidates, absent when `model` is omitted
- **SPEC-004.B18:** attempt metadata: compact per-attempt records for session/debug/UI surfaces

Attempt metadata should stay compact:

```ts
{
  attemptedModel: string;
  attempt: number;
  success: boolean;
  exitCode?: number;
  error?: string;
  retryable?: boolean;
}
```

Do not store full child transcripts in attempt metadata; child sessions already own transcript persistence when enabled.

## SPEC-004.P12 5. Interfaces

### SPEC-004.P13 Agent frontmatter contract

`model` is optional. When present, accepted shapes are:

- **SPEC-004.B19:** non-empty string
- **SPEC-004.B20:** non-empty list of strings and/or objects
- **SPEC-004.B21:** object with `id` and optional `when`

Object contract:

| Key    | Required | Meaning                                                    |
| ------ | -------- | ---------------------------------------------------------- |
| `id`   | Yes      | Pi model string, optionally with a Pi thinking suffix      |
| `when` | No       | Safe environment expression controlling candidate validity |

Unknown object keys fail loudly.

### SPEC-004.P14 `when` contract

Supported expressions:

| Form              | Meaning                                      |
| ----------------- | -------------------------------------------- |
| `$VAR`            | true when env var exists and is truthy       |
| `!$VAR`           | true when env var is missing or false-like   |
| `$VAR == "value"` | true when raw env value exactly equals value |
| `$VAR != "value"` | true when raw env value does not equal value |

Single-quoted values are also valid. Env var names must match `[A-Za-z_][A-Za-z0-9_]*`. Truthiness treats missing, empty, `false`, `0`, `no`, and `off` as false; false-like checks are case-insensitive. Surrounding expression whitespace is ignored; equality comparisons use raw env values without trimming. Empty or unsupported expressions fail loudly.

### SPEC-004.P15 Direct `--agent` contract

Direct top-level agent mode:

- **SPEC-004.B22:** validates declared model policy during startup
- **SPEC-004.B23:** applies the first valid candidate when model inheritance is not suppressed by CLI override
- **SPEC-004.B24:** applies candidate thinking only when the selected candidate includes an explicit thinking suffix
- **SPEC-004.B25:** treats explicit `--model`, `-m`, or `--provider` as suppressing model-policy application for the selected agent
- **SPEC-004.B26:** fails hard if the selected inherited candidate cannot be applied
- **SPEC-004.B27:** does not retry/advance after the main generation request starts

### SPEC-004.P16 `subagent` tool contract

The public tool schema remains unchanged. Model-chain behavior is transparent to the calling agent. The agent-visible response is still the successful child output or a clear subagent failure.

Human/session/debug surfaces may show compact attempt summaries such as candidate used and number of failed attempts.

## SPEC-004.P17 6. Testing

Core behavior is covered by focused tests under `pi/extensions/tools/subagent/*.test.ts`, especially discovery/model-policy parsing, runtime retry/advance behavior, rendering boundaries, and manifest persistence.

Full package validation uses `pnpm check`.

## SPEC-004.P18 7. Open Questions

- **SPEC-004.B28:** Should Pi expose structured provider error codes later so this extension can stop relying on text classifiers for runtime provider failures?
- **SPEC-004.B29:** Should direct top-level `--agent` eventually gain true generation-level retry/advance support if Pi adds a suitable lifecycle hook?
- **SPEC-004.B30:** Should the `when` grammar grow `&&`/`||` once real configs need it, or should users keep composing profiles into one env var?

## SPEC-004.P19 8. Code Locations

Implementation lives in `pi/extensions/tools/subagent/`. Related domain context lives in [SPEC-003.P1](./subagent--discovery-and-config.md#spec-003p1-1-overview) and [SPEC-005.P1](./subagent--orchestration.md#spec-005p1-1-overview).

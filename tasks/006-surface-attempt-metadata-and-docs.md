# Task 6: Surface attempt metadata and docs

## Scope

Type: AFK

Expose compact operational metadata for model-chain attempts to human/debug/session surfaces, and update docs/specs to match the implemented behavior. This slice should not change the public `subagent` tool input shape or add model routing details to successful agent-visible content.

## Must implement exactly

- Add compact attempt metadata to runtime result types:
  - attempted model string
  - per-candidate attempt number
  - success boolean
  - optional exit code
  - optional short error summary
  - optional retryable flag
- Persist compact attempt metadata in single-agent session manifests when parent session persistence is enabled.
- Ensure metadata does not duplicate full child transcripts.
- Update TUI/debug rendering so humans can see concise model-chain information, such as the final candidate used and failed attempt count.
- Keep successful parent-visible subagent content free of operational attempt chatter, except existing resume information.
- Ensure terminal all-candidate failure includes enough compact attempt summary for the calling agent to understand that the subagent failed due to model/provider availability.
- Do a final consistency pass on `pi-extensions/tools/subagent/README.md` for the new `model` string/list/object examples, `when` syntax, direct-mode behavior, and transparent delegated runtime behavior.
- Update relevant specs from planned wording to living implemented wording where the code now matches behavior, preserving slice-specific updates made by earlier tasks.
- Add or update tests for manifest serialization and rendering/debug output.

## Done when

- Attempt metadata is present in persisted manifests for model-chain runs.
- Human-facing UI/debug/session surfaces show concise operational metadata.
- Successful agent-visible results still contain only the child result plus existing resume text.
- README documents the unified `model` field and `when` grammar without introducing any second model-list field.
- Relevant specs accurately describe implemented code and no longer present completed MVP behavior as planned.
- Relevant validation passes: targeted session/render tests plus the repo's required full verification command.

## Out of scope

- Public `subagent` tool parameter changes.
- Additional `when` grammar beyond the MVP.
- Direct top-level generation retry/advance after startup.
- New global settings for retry count.

## References

- `specs/subagent--dynamic-model-selection.md`
- `specs/subagent--discovery-and-config.md`
- `specs/subagent--orchestration.md`
- `pi-extensions/tools/subagent/README.md`
- `pi-extensions/tools/subagent/types.ts`
- `pi-extensions/tools/subagent/session.ts`
- `pi-extensions/tools/subagent/render.ts`
- `skills/robustness/SKILL.md`

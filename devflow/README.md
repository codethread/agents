# Devflow Workspace

This workspace holds durable planning artifacts for the repository.

## Structure

- `devflow/specs/` — canonical durable specs
- `devflow/rfcs/` — durable decision records
- `devflow/feat/<feat-name>/` — active feature folder with proposal, plan, specs, and tasks
- `devflow/archive/` — completed or abandoned feature folders

## Specs index

- `SPEC-001` — [project-rules--autoload.md](./specs/project-rules--autoload.md)
- `SPEC-002` — [prompt-history.md](./specs/prompt-history.md)
- `SPEC-003` — [subagent--discovery-and-config.md](./specs/subagent--discovery-and-config.md)
- `SPEC-004` — [subagent--dynamic-model-selection.md](./specs/subagent--dynamic-model-selection.md)
- `SPEC-005` — [subagent--orchestration.md](./specs/subagent--orchestration.md)
- `SPEC-006` — [system-prompt--assembly.md](./specs/system-prompt--assembly.md)

## Notes

RFCs are kept separately under `devflow/rfcs/`. Feature plans and task queues live inside their feature folders so active work stays grouped with its context.

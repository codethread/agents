# Devflow Workspace

This workspace holds durable planning artifacts for the repository.

## Structure

- `devflow/specs/` — canonical durable specs
- `devflow/rfcs/` — active decision records not yet implemented by an archived feature
- `devflow/feat/<feat-name>/` — active feature folder with proposal, plan, specs, and tasks
- `devflow/archive/` — completed or abandoned feature folders, including any RFCs implemented by those features

## Specs index

- `SPEC-001` — [project-rules--autoload.md](./specs/project-rules--autoload.md)
- `SPEC-002` — [prompt-history.md](./specs/prompt-history.md)
- `SPEC-006` — [system-prompt--assembly.md](./specs/system-prompt--assembly.md)

## Notes

RFCs stay under `devflow/rfcs/` until a feature implements them. When that feature is finished, its linked implemented RFCs move into the feature archive under `rfcs/`. Feature plans and task queues live inside their feature folders so active work stays grouped with its context.

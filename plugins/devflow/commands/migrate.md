---
description: Migrate repository planning files into the devflow workspace structure
argument-hint: optional active feature name for existing plan/task files
disable-model-invocation: true
---

# Devflow workspace migration

Migrate this repository from the previous planning layout to the current `devflow/` workspace layout.

Study $ARGUMENTS

Your job: perform a one-time filesystem migration only. Do not change product code or rewrite planning content beyond path/link fixes required by the move.

## Target structure

```text
devflow/
|-- README.md
|-- rfcs/
|-- specs/
|-- <feat-name>/
|   |-- proposal.md
|   |-- specs/
|   |-- <feat-name>.plan.md
|   `-- tasks/
`-- archive/
```

## Migration rules

1. Create `devflow/`, `devflow/rfcs/`, `devflow/specs/`, and `devflow/archive/` if missing.
2. Move root durable specs into `devflow/specs/`.
3. Move RFC files into `devflow/rfcs/`.
4. Move each existing implementation plan into a feature folder:
   - infer `<feat-name>` from the plan file name when safe
   - otherwise use the feature name supplied in `$ARGUMENTS`
   - final path: `devflow/<feat-name>/<feat-name>.plan.md`
5. Move any active task queue into the same feature folder:
   - final path: `devflow/<feat-name>/tasks/index.yml`
   - task markdown files stay under `devflow/<feat-name>/tasks/`
   - preserve each task's `task_file: tasks/<file>.md` value
6. If the task queue has a task notes README, merge its useful context and Developer Notes into the feature plan under `Task context` and `Developer Notes`, then remove the task notes README.
7. If no feature proposal exists for an active feature, create `devflow/<feat-name>/proposal.md` with a terse migration note and links to the migrated plan/spec/RFC context. Do not invent product requirements.
8. Create or update `devflow/README.md` as an index into root specs plus a short explanation of the current structure. Do not summarize RFC contents there.
9. Update internal markdown links that broke because of the move.
10. Update any local scripts/docs in the repository that invoke the devflow AFK loop so they pass the active feature name/folder.
11. Leave unrelated files untouched.

## Ambiguity handling

Ask the user before moving files if any of these are true:

- More than one active feature could own the current task queue.
- Multiple plans exist and tasks cannot be matched to one plan.
- A file name collision would overwrite content.
- A root spec and feature-local pending spec cannot be distinguished safely.

Do not invent a feature name unless it is obvious from an existing plan/task context or provided in `$ARGUMENTS`.

## Validation

After migrating:

1. Run `tree --charset=ascii --gitignore devflow` and inspect the result.
2. Run a repository search to ensure planning references point at the new `devflow/` paths, except inside archived historical content if any was already archived.
3. Run formatting for touched markdown if the repository provides a formatter.
4. Report:
   - files moved
   - links or scripts updated
   - any ambiguous items left untouched
   - validation commands run

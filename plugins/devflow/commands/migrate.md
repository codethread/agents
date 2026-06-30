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
|-- feat/
|   `-- <feat-name>/
|       |-- proposal.md
|       |-- specs/
|       |-- <feat-name>.plan.md
|       `-- tasks/
`-- archive/
```

## Source patterns

The previous layout was flatter. Migrate these known source patterns when present:

| Previous path pattern              | New path pattern                                            |
| ---------------------------------- | ----------------------------------------------------------- |
| `specs/*.md`                       | `devflow/specs/*.md`                                        |
| `specs/rfcs/*.md` or `rfcs/*.md`   | `devflow/rfcs/*.md`                                         |
| `plans/<feat-name>.md`             | `devflow/feat/<feat-name>/<feat-name>.plan.md`              |
| `tasks/index.yml`                  | `devflow/feat/<feat-name>/tasks/index.yml`                  |
| `tasks/<zero-padded-id>-<slug>.md` | `devflow/feat/<feat-name>/tasks/<zero-padded-id>-<slug>.md` |
| `tasks/README.md`                  | merged into `devflow/feat/<feat-name>/<feat-name>.plan.md`  |

If a repository has only `specs/` and no `plans/` or `tasks/`, migrate specs/RFCs and create only the root `devflow/` workspace. Do not invent a feature folder unless there is active feature context to own.

## Migration rules

1. Create `devflow/`, `devflow/rfcs/`, `devflow/specs/`, and `devflow/archive/` if missing.
2. Move root durable specs from `specs/*.md` into `devflow/specs/`.
3. Move RFC files from `specs/rfcs/*.md` or `rfcs/*.md` into `devflow/rfcs/`.
4. Move each existing implementation plan from `plans/` into a feature folder:
   - infer `<feat-name>` from the plan file name when safe
   - otherwise use the feature name supplied in `$ARGUMENTS`
   - final path: `devflow/feat/<feat-name>/<feat-name>.plan.md`
5. Move any active task queue from `tasks/` into the same feature folder:
   - final path: `devflow/feat/<feat-name>/tasks/index.yml`
   - task markdown files stay under `devflow/feat/<feat-name>/tasks/`
   - preserve each task's `task_file: tasks/<file>.md` value
6. If the task queue has a task notes README, merge its useful context and Developer Notes into the feature plan under `Task context` and `Developer Notes`, then remove the task notes README.
7. If no feature proposal exists for an active feature, create `devflow/feat/<feat-name>/proposal.md` with a terse migration note and links to the migrated plan/spec/RFC context. Do not invent product requirements.
8. Create or update `devflow/README.md` as an index into root specs plus a short explanation of the current structure. Do not summarize RFC contents there.
9. Remove the old source files and directories after their content has been moved or merged. Do not leave duplicate planning artifacts in `specs/`, `specs/rfcs/`, `rfcs/`, `plans/`, or root `tasks/`.
10. Update internal markdown links that broke because of the move.
11. Add configuration identification to migrated devflow documents as best as possible:
    - add a stable `Document ID` and `Configuration identification` metadata line when the document type supports it
    - add document-prefixed sub IDs to headings, bullets, table rows, decisions, options, risks, open questions, task context, and developer notes using the current devflow templates as the guide
    - use the next sequential numeric document ID for each artifact type (`RFC-<nnn>`, `SPEC-<nnn>`, `PROP-<nnn>`, `PLAN-<nnn>`, `DELTA-<nnn>`, `TASK-<nnn>`) by scanning existing document IDs; ask the user if the next number is ambiguous
    - preserve any existing human-readable numbering or IDs; do not renumber existing references unless there are no external references yet
12. Replace file-only references between devflow documents with the most specific identified reference available, using markdown anchors for the new IDs when safe. Keep file-level links only when no specific section or point can be inferred.
13. Update any local scripts/docs in the repository that invoke the devflow AFK loop so they pass either the bare `<feat-name>` or the nested folder path `devflow/feat/<feat-name>`. Do not leave callers using the stale `devflow/<feat-name>` path.
14. Leave unrelated files untouched.

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
2. Run a repository search to ensure planning references point at the new `devflow/feat/<feat-name>` paths, except inside archived historical content if any was already archived; specifically catch stale `devflow all devflow/<feat-name>` callers.
3. Inspect migrated devflow documents for configuration identification: stable `Document ID` and `Configuration identification` metadata where supported, document-prefixed sub IDs on sections/list items/table rows, and cross-document references updated to point at specific IDs when safe.
4. Run formatting for touched markdown if the repository provides a formatter.
5. Report:
   - files moved
   - links or scripts updated
   - any ambiguous items left untouched
   - validation commands run

## User Input

$ARGUMENTS

# Task authoring templates

## `tasks/index.yml`

```yaml
tasks:
  - id: 1
    description: Terse task title
    task_file: tasks/001-terse-task-title.md
    status: pending
    blocked_by: []
```

## Feature plan notes

```markdown
## PLAN-<name>-<nnn>.P8 Task context

- **PLAN-<name>-<nnn>.TC1:** Problem statement / MVP goal, important references, and task strategy.

## PLAN-<name>-<nnn>.P9 Developer Notes

Append notes here. Do not rewrite earlier notes.

### PLAN-<name>-<nnn>.DN1 Task <id>: <description> — <YYYY-MM-DD>

- Note relevant for later agents or follow-up scope.
```

## Task file

```markdown
# Task <id>: <description>

**Document ID:** `TASK-<name>-<nnn>[@<version>]`
**Configuration identification:** Document IDs must be ordered as document type, short name, sequential id, then optional version: `TASK-Dwr-001` for v1 and `TASK-Dwr-001@2` for v2. Omit `@1`; append `@2`, `@3`, etc. only when a new version supersedes an externally referenced document. Prefix every nested point ID with the full document ID, for example `TASK-Dwr-001.P1` or `TASK-Dwr-001@2.P1`, so references are globally grepable and do not clash across documents. If the next number or version is unclear, ask before creating the document.

## TASK-<name>-<nnn>.P1 Scope

Type: AFK

## TASK-<name>-<nnn>.P2 Must implement exactly

- **TASK-<name>-<nnn>.MI1:** Required implementation point.

## TASK-<name>-<nnn>.P3 Done when

- **TASK-<name>-<nnn>.DW1:** Acceptance criterion.

## TASK-<name>-<nnn>.P4 Out of scope

- **TASK-<name>-<nnn>.OS1:** Boundary excluded from this task.

## TASK-<name>-<nnn>.P5 References

- **TASK-<name>-<nnn>.REF1:** Relevant proposal, plan, spec, RFC, or code reference.
```

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
## PLAN-<nnn>.P8 Task context

- **PLAN-<nnn>.TC1:** Problem statement / MVP goal, important references, and task strategy.

## PLAN-<nnn>.P9 Developer Notes

Append notes here. Do not rewrite earlier notes.

### PLAN-<nnn>.DN1 Task <id>: <description> — <YYYY-MM-DD>

- Note relevant for later agents or follow-up scope.
```

## Task file

```markdown
# Task <id>: <description>

**Document ID:** `TASK-<nnn>`
**Configuration identification:** Use the next stable sequential task document ID, for example `TASK-001`. Prefix every nested point ID with that document ID, for example `TASK-001.P1` or `TASK-001.MI1`, so references are globally grepable and do not clash across documents. If the next number is unclear, ask before creating the task.

## TASK-<nnn>.P1 Scope

Type: AFK

## TASK-<nnn>.P2 Must implement exactly

- **TASK-<nnn>.MI1:** Required implementation point.

## TASK-<nnn>.P3 Done when

- **TASK-<nnn>.DW1:** Acceptance criterion.

## TASK-<nnn>.P4 Out of scope

- **TASK-<nnn>.OS1:** Boundary excluded from this task.

## TASK-<nnn>.P5 References

- **TASK-<nnn>.REF1:** Relevant proposal, plan, spec, RFC, or code reference.
```

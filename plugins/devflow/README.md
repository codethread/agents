# Devflow Plugin

Workflow helpers for turning planned work into small, reviewable implementation slices.

## Planning documents

Three skills cover the spec → plan → tasks pipeline, each owning one kind of knowledge:

| Skill                              | Document     | Owns                                                      | Lifetime                       |
| ---------------------------------- | ------------ | --------------------------------------------------------- | ------------------------------ |
| `skills/spec-authoring/SKILL.md`   | `specs/*.md` | Why, boundaries, domain contracts; module-level refs only | Permanent, evolves with domain |
| `skills/plan-authoring/SKILL.md`   | `plans/*.md` | How and where: file paths, phases, migrations             | Deleted when the change ships  |
| `skills/afk-create-tasks/SKILL.md` | `tasks/`     | Execution slices for the AFK loop                         | Lives with the task queue      |

Specs never contain file paths or implementation phases — that detail lives in a technical plan, which is retired (durable decisions harvested into the spec, then deleted) once the change is complete.

## AFK loop

The AFK loop is a single-worktree automation flow for repeatedly running one task slice at a time:

1. select the next runnable task from `tasks/index.yml`
2. run `/flow-init--afk` against that selected slice, with notes from `tasks/README.md`
3. run `/flow-build--refine`, `/flow-build--smoke`, and `/flow-build--finalise` as needed
4. stop when tasks are exhausted, blocked, the initial runner call fails, or repeated later runner failures occur

By default the loop uses Pi (`openai-codex/gpt-5.5:low`). Pass `--claude` to use the Claude CLI instead (default model: `sonnet`). Pass `--model` to override the model for either runner.

Use separate git worktrees for parallelism. The loop intentionally does not run concurrent tasks in one worktree.

### Main files

- `scripts/afk-loop.nu` — orchestration, task selection, retry limits, stop-token parsing, and clean-worktree checks
- `commands/flow-init--afk.md` — unattended single-slice implementation prompt
- `commands/flow-init--hitl.md` — human-in-the-loop single-slice prompt
- `commands/flow-build--refine.md` — simplify the just-built slice
- `commands/flow-build--smoke.md` — smoke-test the just-built slice
- `commands/flow-build--finalise.md` — cleanup prompt after refine/smoke leaves uncommitted work
- `skills/afk-create-tasks/SKILL.md` — creates deterministic `tasks/index.yml`, `tasks/README.md`, and per-task markdown files

### Task queue shape

The loop always reads tasks from `tasks/index.yml` and task notes from `tasks/README.md`; these paths are not inferred from the `study` argument.

`tasks/index.yml` uses one top-level `tasks` list:

```yaml
tasks:
  - id: 1
    description: Terse task title
    task_file: tasks/001-terse-task-title.md
    status: pending
    blocked_by: []
```

Statuses:

- `pending` — ready to start when dependencies are complete
- `in_progress` — selected or being continued
- `blocked` — needs human input; skipped by the AFK loop
- `complete` — finished and committed

Keep dependencies in `blocked_by`. Put discoveries, blockers, and follow-up notes in `tasks/README.md` under `Developer Notes` rather than adding YAML fields.

### AFK vs HITL slices

AFK slices are unattended implementation work. HITL slices capture decisions, access grants, design review, or manual QA that must happen before automation is safe.

HITL slices should be visible in prose, not the YAML schema:

- prefix the description with `[HITL]`
- set the task status to `blocked` until human input exists
- write `Type: HITL` under `## Scope` in the task file

AFK tasks unblocked by a HITL decision should depend on that HITL task via `blocked_by`.

### Stop tokens

The AFK loop machine-parses only these unhappy-path tokens from `/flow-init--afk` and `/flow-build--finalise` output:

- `BLOCKED`
- `NO_TASKS_REMAIN`

Any other successful output is treated as a success summary, so success summaries must not include those literal tokens.

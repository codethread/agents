# Technical Plan Authoring Guide

A technical plan is the reviewable bridge between feature framing/spec work and a detailed AFK task queue. It answers: "How should we build this, at a level worth reviewing before we commit to task slices?"

Plans live inside active feature folders: `devflow/feat/<feat-name>/<feat-name>.plan.md`. They are feature-local context, not root documentation. When work ships or is abandoned, the whole feature folder is moved to `devflow/archive/yy-mm-dd__<feat-name>/` after durable spec outcomes are merged into `devflow/specs/`; any RFC implemented by the feature moves into that archive's `rfcs/` folder.

## Variables

| Variable                              | Value                                          | Notes                                                      |
| ------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| DEVFLOW_DIR                           | `devflow/`                                     | Planning workspace root                                    |
| FEATURE_DIR                           | `devflow/feat/<feat-name>/`                    | Active feature folder                                      |
| PROPOSAL_FILE                         | `devflow/feat/<feat-name>/proposal.md`         | Problem framing and scope                                  |
| FEATURE_SPECS                         | `devflow/feat/<feat-name>/specs/`              | New specs and deltas for this feature                      |
| PLAN_FILE                             | `devflow/feat/<feat-name>/<feat-name>.plan.md` | Feature-local implementation plan and developer notes      |
| TASKS_DIR                             | `devflow/feat/<feat-name>/tasks/`              | AFK task queue for this feature                            |
| ROOT_SPECS                            | `devflow/specs/`                               | Durable specs updated when work ships                      |
| [rfc-authoring](./rfc-authoring.md)   | `rfc-authoring`                                | Companion reference for pre-feature decision records       |
| [spec-authoring](./spec-authoring.md) | `spec-authoring`                               | Companion reference for root specs and feature spec deltas |
| [task-authoring](./task-authoring.md) | `task-authoring`                               | Converts reviewed plans into AFK task slices               |

## Prerequisites

- The change has a clear goal: a feature, fix, or refactor, not open-ended exploration.
- Direction/tradeoff questions are resolved enough to plan; unresolved direction belongs in [rfc-authoring](./rfc-authoring.md) first.
- `devflow/feat/<feat-name>/proposal.md` exists or can be written as part of the planning pass.
- Accepted RFCs, root specs, and feature-local spec deltas relevant to the change have been read.
- The affected code has been read enough to avoid planning against imagined structure.

## Knowledge

### Document split

| Document         | Owns                                                              | Lifetime                                                              |
| ---------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| RFC              | Idea framing, alternatives, tradeoffs, recommendation, decision   | Active until implemented, then archived with the implementing feature |
| Root spec        | Current durable contracts, boundaries, rationale, non-goals       | Permanent, evolves with domain                                        |
| Feature proposal | Problem framing, goals, scope, links to decisions                 | Archived with feature                                                 |
| Feature spec     | New specs or deltas to merge into root specs                      | Promoted/merged, then archived                                        |
| Feature plan     | Build strategy, phases, validation, task context, developer notes | Archived with feature                                                 |
| Task queue       | Detailed AFK slices and acceptance checks                         | Archived with feature                                                 |
| Code + tests     | What exists and how it behaves                                    | Ground truth                                                          |

The plan links to accepted RFCs, the proposal, and spec deltas. It never restates their full rationale. Durable contracts belong in root specs or feature-local spec deltas; exact execution contracts belong in task files.

### Why plans exist

Plans earn their keep when a change is too large or risky to jump straight from proposal/spec to tasks:

- Humans or review agents can critique the approach before task details harden.
- Specs stay free of implementation mechanics.
- Task files avoid carrying architecture that should be reviewed once, centrally.
- The AFK loop has one feature-local place for task context and developer notes.

Skip a plan only for small, obvious changes that will not use a devflow task queue or AFK loop. Any feature with `tasks/` needs at least a minimal plan marked Reviewed because the plan carries task context and Developer Notes.

### Level of detail

Plans are high-level enough to review and low-level enough to guide task generation:

- Name affected modules, packages, integration points, and key files only when they are architectural anchors.
- Do not include exhaustive file inventories, per-function TODOs, or command-by-command instructions.
- Phases describe independently reviewable delivery increments, not final task files.
- Validation strategy names the suites, scenarios, or manual checks that matter; task files later make checks exact.
- Developer Notes are append-only operational context for agents running the task loop.

### Plan status values

- **Draft** — approach is still being written or critiqued; do not generate AFK tasks yet.
- **Reviewed** — approach has been critiqued and is ready to slice into tasks.
- **Active** — tasks or implementation are in progress.
- **Shipped** — durable outcomes have been merged into root specs and the feature folder is ready to archive.
- **Abandoned** — work stopped intentionally; the feature folder is ready to archive with rationale preserved.

## Decisions

Entry state: DETERMINE_MODE

### DETERMINE_MODE

- guard: user wants to explore unresolved direction or tradeoffs → redirect to [rfc-authoring](./rfc-authoring.md)
- guard: user wants durable current contracts → redirect to [spec-authoring](./spec-authoring.md)
- guard: user wants to plan a decided non-trivial feature/change → WRITE_PLAN
- guard: user wants tasks for a non-trivial change and no reviewed plan exists → WRITE_PLAN first, then offer [task-authoring](./task-authoring.md)
- guard: user wants tasks for a small obvious change → create/use a minimal Reviewed plan, then offer [task-authoring](./task-authoring.md)
- guard: user wants to critique or revise an existing feature plan → REVIEW_OR_UPDATE_PLAN
- guard: the change has shipped or was abandoned → ARCHIVE_FEATURE

### WRITE_PLAN

- action: write the plan per Procedures
- guard: no feature proposal exists → create or update `proposal.md` first
- guard: planning surfaces durable contract changes → record them in feature-local spec deltas via [spec-authoring](./spec-authoring.md), then continue
- guard: plan is Draft → request review/critique before task generation
- guard: user wants unattended execution after review → offer [task-authoring](./task-authoring.md) to slice the phases
- always → DONE

### REVIEW_OR_UPDATE_PLAN

- action: revise the plan in place; plans are working documents, not history logs
- guard: revision changes durable contracts → update feature-local spec deltas via [spec-authoring](./spec-authoring.md)
- guard: review is complete and blockers are resolved → set status to Reviewed
- always → DONE

### ARCHIVE_FEATURE

- action: merge durable spec outcomes, mark status, move feature folder into archive
- always → DONE

### DONE

- terminal state

## Procedures

### WRITE_PLAN

1. Read accepted RFCs, `proposal.md`, affected root specs, feature-local spec deltas, and affected code first.
2. Ensure `devflow/feat/<feat-name>/` exists.
3. Create `devflow/feat/<feat-name>/<feat-name>.plan.md`.
4. Write these sections using the plan template in `./plan-authoring.template.md`.

5. Omit sections that genuinely do not apply, except Goal and scope, Approach, Affected areas, Implementation phases, Validation strategy, Task context, and Developer Notes.
6. Include the document ID and document-prefixed sub IDs for sections and list/table items so feature discussion can cite exact globally grepable points.
7. Leave status as Draft until the plan has been critiqued. Set Reviewed only after review feedback is addressed.

### REVIEW_OR_UPDATE_PLAN

1. Read the plan, proposal, linked RFC/specs, task queue if present, and affected code.
2. Critique for approach fit, missing dependencies, over-broad phases, hidden domain decisions, and task-generation readiness.
3. Rewrite the plan in place to address feedback; do not preserve stale text for history.
4. Move durable contract changes to feature-local spec deltas or new specs via [spec-authoring](./spec-authoring.md).
5. If direction-level uncertainty remains, pause task generation and use [rfc-authoring](./rfc-authoring.md).
6. When the approach is settled and phases are sliceable, set status to Reviewed.

### ARCHIVE_FEATURE

Run when a feature has shipped or been intentionally abandoned.

1. If shipped, use [spec-authoring](./spec-authoring.md) and merge durable feature spec deltas into `devflow/specs/`, promote any new feature specs that should become root specs, update `devflow/README.md`, and mark feature-local deltas `Merged`.
2. Confirm code and tests cover shipped task scope. Record cut, deferred, or abandoned scope in the plan's final Developer Notes; do not promote unshipped behavior into root specs unless the user explicitly asks.
3. Set plan status to Shipped or Abandoned and update `Last Updated`.
4. Move `devflow/feat/<feat-name>/` to `devflow/archive/yy-mm-dd__<feat-name>/`.
5. Move any RFC implemented by this feature from `devflow/rfcs/` into `devflow/archive/yy-mm-dd__<feat-name>/rfcs/`.
6. Do not delete proposal, plan, task, or archived RFC files from the archived folder; preserving feature-local context is the point of the archive.

## Constraints

- Plans are reviewable strategy documents, not task queues.
- One active plan per feature folder. Split multi-feature roadmaps into separate feature folders.
- Never plan against imagined code structure; read affected code first.
- A Draft plan must not be sliced into AFK tasks; for small obvious queued work, create and use a minimal reviewed plan.
- Once [task-authoring](./task-authoring.md) has generated tasks, the task index owns sequencing and detailed acceptance criteria; stop maintaining the phase list as a parallel task tracker.
- When work completes, root specs become the current source of truth, the feature folder moves to archive, and implemented RFCs move with it.
- Preserve existing reference IDs when editing; append new IDs rather than renumbering unless the document is still a draft with no external references.

## Validation

For a written or updated plan:

- [ ] Lives at `devflow/feat/<feat-name>/<feat-name>.plan.md`
- [ ] Links to the proposal, relevant RFCs, root specs, and feature-local specs
- [ ] Goal and scope, Approach, Affected areas, Implementation phases, Validation strategy, Task context, and Developer Notes are present
- [ ] Document has a stable sequential `PLAN-<nnn>` ID
- [ ] Sections and list/table items have stable document-prefixed sub IDs
- [ ] Phase outcomes are independently buildable and verifiable
- [ ] Plan stays at strategy/phase level; no per-task implementation checklist
- [ ] Durable contract changes surfaced while planning were recorded in feature-local specs
- [ ] Status is Draft until critique is complete, then Reviewed before task generation

For archiving:

- [ ] Shipped durable outcomes are merged into root specs
- [ ] Cut or abandoned scope is recorded before archive
- [ ] Feature folder moved intact to `devflow/archive/yy-mm-dd__<feat-name>/`
- [ ] Implemented RFCs moved into `devflow/archive/yy-mm-dd__<feat-name>/rfcs/`

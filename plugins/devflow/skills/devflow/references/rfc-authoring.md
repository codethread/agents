# RFC Authoring Guide

RFCs are pre-feature decision records. They frame an unresolved idea, compare options, recommend a direction, and record the outcome before the work becomes a feature proposal, spec delta, plan, or task queue.

RFCs live in the repository planning workspace at `devflow/rfcs/` while they are unresolved or not yet implemented. When a feature implements an RFC and is finished, move that RFC into the feature archive at `devflow/archive/yy-mm-dd__<feat-name>/rfcs/`. The current contract belongs in `devflow/specs/`.

## Variables

| Variable                              | Value                  | Notes                                                      |
| ------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| DEVFLOW_DIR                           | `devflow/`             | Planning workspace root                                    |
| RFCS_DIR                              | `devflow/rfcs/`        | RFC documents                                              |
| ROOT_SPECS                            | `devflow/specs/`       | Durable specs that receive accepted outcomes               |
| FEATURE_DIR                           | `devflow/feat/<feat>/` | Active feature folder created after a direction exists     |
| [spec-authoring](./spec-authoring.md) | `spec-authoring`       | Companion reference for durable specs and feature deltas   |
| [plan-authoring](./plan-authoring.md) | `plan-authoring`       | Companion reference for feature-local implementation plans |
| [task-authoring](./task-authoring.md) | `task-authoring`       | Companion reference for feature-local AFK task queues      |

## Prerequisites

- The idea has meaningful uncertainty: a tradeoff, architectural choice, product direction, or scope question worth recording.
- Relevant specs, active feature folders, README files, and code have been read when the idea touches existing behavior.
- The user is asking to explore or decide an idea, not merely implement an already-decided change.

## Knowledge

### Document split

| Document         | Owns                                                                    | Lifetime                                                              |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| RFC              | Idea framing, alternatives, tradeoffs, recommendation, decision outcome | Active until implemented, then archived with the implementing feature |
| Root spec        | Current durable contracts, boundaries, rationale, non-goals             | Permanent, evolves with domain                                        |
| Feature proposal | Problem framing, goals, scope, links to decisions                       | Archived with feature                                                 |
| Feature plan     | Reviewable build strategy, phases, validation, developer notes          | Archived with feature                                                 |
| Task queue       | AFK execution slices, exact references, acceptance checks               | Archived with feature                                                 |
| Code + tests     | What exists and how it behaves                                          | Ground truth                                                          |

Accepted RFCs feed durable outcomes into root specs and feature-local planning. Downstream documents link to the RFC for decision history; they do not copy the alternatives table or debate.

Rejected RFCs still have value because they prevent future agents from reopening the same question without new evidence.

### When to write an RFC

Write an RFC when the next useful artifact is a decision record:

- Multiple plausible approaches exist and the tradeoff matters.
- The change crosses system boundaries or affects long-lived architecture.
- Product or user experience direction is unclear.
- The safest next artifact is a recommendation, not code.
- The user asks to consider, explore, propose, write an RFC, or think through an idea.

Skip an RFC when:

- The approach is already chosen and the user needs implementation sequencing — use [plan-authoring](./plan-authoring.md) inside a feature folder.
- The request is durable domain documentation with little tradeoff exploration — use [spec-authoring](./spec-authoring.md).
- The change is a small obvious fix where code and tests are clearer than a proposal document.

### Location and naming

Create RFCs in `devflow/rfcs/` with creation date plus a short kebab-case slug:

- `2026-06-22-subagent-cost-budget.md`
- `2026-06-22-devflow-workspace.md`

Good filenames describe the idea or decision. The RFC's `Document ID` is separate from the filename and uses the next sequential stable ID, such as `RFC-001`, so points inside the document can be globally grepable as `RFC-001.O1`, `RFC-001.REC1`, and so on.

### RFC status values

- **Draft** — authoring in progress; not ready for decision
- **Open** — ready for feedback or explicit decision
- **Accepted** — proposal chosen; follow-up belongs in specs and feature folders
- **Rejected** — proposal intentionally not pursued
- **Superseded** — replaced by a newer RFC; link to the replacement

RFC status records the decision state, not implementation progress. Do not add implementation statuses to RFCs. Finished feature work retires the implemented RFC by moving the RFC file into that feature's archive.

## Decisions

Entry state: DETERMINE_MODE

### DETERMINE_MODE

- guard: user wants to consider, explore, propose, or decide an idea → WRITE_RFC
- guard: user wants to revise an existing RFC before decision → UPDATE_RFC
- guard: user wants to accept, reject, or supersede an RFC → CLOSE_RFC
- guard: user wants feature framing for a decided change → redirect to [plan-authoring](./plan-authoring.md) or [spec-authoring](./spec-authoring.md) as appropriate
- guard: user wants durable current contracts → redirect to [spec-authoring](./spec-authoring.md)
- guard: user wants detailed execution slices → redirect to [task-authoring](./task-authoring.md), preferably after a reviewed plan for non-trivial work

### WRITE_RFC

- action: write the RFC per Procedures
- guard: exploration proves the decision is trivial → explain that an RFC is unnecessary and redirect to the lighter artifact
- always → DONE

### UPDATE_RFC

- action: update the RFC in place; it is a living proposal until closed
- guard: update changes durable contracts in an accepted RFC → update affected root specs or feature deltas via [spec-authoring](./spec-authoring.md)
- always → DONE

### CLOSE_RFC

- guard: outcome is Accepted → record the decision, harvest durable outcomes via [spec-authoring](./spec-authoring.md), then use [plan-authoring](./plan-authoring.md) if implementation is needed
- guard: outcome is Rejected → record why and stop
- guard: outcome is Superseded → link to replacement and stop
- always → DONE

### DONE

- terminal state

## Procedures

### WRITE_RFC

1. Read relevant existing context: root specs, active feature folders, READMEs, and code when the idea affects existing behavior.
2. Create `devflow/rfcs/` if it does not exist.
3. Create `devflow/rfcs/YYYY-MM-DD-<slug>.md` using the current date and a short idea slug.
4. Assign the next sequential stable `Document ID` by scanning existing RFCs for `RFC-<nnn>` IDs. If the next number is ambiguous, ask the user before writing.
5. Write this structure using `./rfc-authoring.template.md`, including the document ID and document-prefixed sub IDs for sections and list/table items.

6. Keep implementation details at consequence level. Do not write phases, task checklists, or code-level runbooks.
7. Preserve existing reference IDs when editing; append new IDs rather than renumbering unless the RFC is still a draft with no external references.
8. Leave status as Draft while actively drafting. Set Open when ready for decision or Accepted/Rejected/Superseded when the user decides.

### UPDATE_RFC

1. Read the RFC and linked context.
2. Update the proposal, options, recommendation, or outcome in place.
3. If new evidence supersedes earlier reasoning, replace stale text rather than preserving a debate log.
4. If an accepted RFC changes durable contracts, update the root spec or feature-local spec delta that owns the current contract.

### CLOSE_RFC

1. Set status to Accepted, Rejected, or Superseded.
2. Fill `## Outcome` with the decision, rationale, date, and follow-up links.
3. For Accepted RFCs, update or create the affected root specs or feature-local spec deltas.
4. If implementation is needed, create or update `devflow/feat/<feat-name>/proposal.md` and continue with [plan-authoring](./plan-authoring.md).

## Constraints

- Keep RFCs concise enough that a future agent can quickly recover the decision.
- Never use an RFC as the current contract; root specs own that.
- Never put implementation phases, task checklists, or detailed migration runbooks in an RFC.
- Link to accepted RFCs from proposals/specs/plans when decision history matters; do not duplicate the full RFC content downstream.

## Validation

- [ ] File lives in `devflow/rfcs/` and follows `YYYY-MM-DD-<slug>.md` naming
- [ ] Status is one of the allowed RFC statuses
- [ ] Problem, goals, options, recommendation, consequences, and outcome are present when relevant
- [ ] Document has a stable `RFC-<nnn>` ID
- [ ] Sections and list/table items have stable document-prefixed sub IDs
- [ ] Alternatives and tradeoffs are clear enough to make the decision repeatable
- [ ] Accepted outcomes that affect current contracts are represented in root specs or feature-local spec deltas

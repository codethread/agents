---
name: plan-authoring
description: >
  Guide for writing ephemeral technical implementation plans that complement domain specs.
  Use when planning how to build a feature or change: file-level architecture, implementation
  phases, migrations, sequencing. Triggers on: "tech plan", "implementation plan", "plan this
  feature", "write a plan", "how should we build". Plans are deleted once the change ships.
metadata:
  intent: >-
    give implementation detail a dedicated, disposable home so specs stay domain-level and code stays the truth
---

# Technical Plan Authoring Guide

A technical plan is the working document for one change: the chosen approach, the files it touches, the sequence to build it in, and the risks along the way. It is deliberately ephemeral — once the change ships, the plan is retired: durable decisions are harvested into the domain spec (SPEC_SKILL) and the mechanics are delegated to the code and test suite. A plan that outlives its change is stale documentation waiting to mislead someone.

This is the one place where file paths, file trees, and phase checklists belong. Specs reference modules at high level; plans name exact files.

## Variables

| Variable    | Value              | Notes                                         |
| ----------- | ------------------ | --------------------------------------------- |
| PLANS_DIR   | `plans/`           | Root directory for active technical plans     |
| SPEC_SKILL  | `spec-authoring`   | Companion skill owning durable domain specs   |
| TASKS_SKILL | `afk-create-tasks` | Converts a plan's phases into AFK task slices |

## Prerequisites

- The change has a clear goal (a feature, fix, or refactor — not an open-ended exploration)
- Relevant domain spec(s) in `specs/` have been read, if they exist
- The affected code has been read — never plan against imagined structure

## Knowledge

### The three-document split

| Document       | Owns                                                      | Lifetime                           |
| -------------- | --------------------------------------------------------- | ---------------------------------- |
| Spec           | Why, boundaries, rejected alternatives, domain contracts  | Permanent, evolves with the domain |
| Technical plan | How and where: file paths, phases, migrations, sequencing | Deleted when the change ships      |
| Code + tests   | What exists and how it behaves                            | The ground truth                   |

A plan links to its spec for rationale and contracts; it never restates them. If planning surfaces a new durable decision (a rejected alternative, a boundary, a contract change), that decision is recorded in the spec — the plan only records the implementation consequences.

### Change naming

Plans are named after the change, not the domain — the opposite of specs. Chronological, feature-shaped names are correct here because the plan dies with the change.

Good names:

- `gate-replay.md`
- `priority-filter.md`
- `sqlite-to-postgres-migration.md`

Bad names:

- `task-engine.md` (that's a spec name — domains get specs, changes get plans)
- `plan-001.md` (opaque)

### Plan status values

- **Draft** — approach still being decided; open questions dominate
- **Active** — approach settled; implementation in progress

There is no "Implemented" status. A finished plan is a deleted plan (see RETIRE_PLAN).

### Level of detail

A plan is read by the agent implementing the change, usually within days of writing. Optimize for build-time usefulness, not archival polish:

- Exact file paths, new-vs-modify, concrete signatures and DDL migrations are all welcome
- Phases must each be independently buildable and verifiable
- Don't pad with background a reader can get from the linked spec or the code
- Don't plan beyond the change's boundary — speculative future phases belong in spec Open Questions or nowhere

### Relationship to AFK tasks

For unattended execution, a plan's phases convert into `tasks/` slices via TASKS_SKILL. The plan is the thinking document; the task files are the execution contract. When both exist, keep sequencing authority in one place: once tasks are generated, the task index owns ordering and the plan's phase checklist is no longer updated.

## Decisions

Entry state: DETERMINE_MODE

### DETERMINE_MODE

- guard: user wants to plan a new change → WRITE_PLAN
- guard: user wants to revise an existing plan (approach changed, scope moved) → UPDATE_PLAN
- guard: the change has shipped (merged, verified) → RETIRE_PLAN
- guard: user is asking for domain rationale, boundaries, or contracts → redirect to SPEC_SKILL

### WRITE_PLAN

- action: write the plan per Procedures
- guard: planning surfaced durable decisions (boundaries, rejected alternatives, contract changes) → record them in the spec via SPEC_SKILL, then continue
- guard: user wants unattended execution → offer TASKS_SKILL to slice the phases
- always → DONE

### UPDATE_PLAN

- action: revise the plan in place; plans are working documents, not history — rewrite freely
- guard: revision changed a durable decision → update the spec via SPEC_SKILL
- always → DONE

### RETIRE_PLAN

- guard: no domain spec exists for the plan's area → create it via SPEC_SKILL first; a plan cannot retire without a durable home for its decisions
- action: harvest, verify delegation, then delete per Procedures
- always → DONE

### DONE

- terminal state

## Procedures

### WRITE_PLAN

1. Read the linked spec(s) and the affected code first
2. Create `PLANS_DIR/<change-name>.md` (kebab-case, named after the change)
3. Write these sections:

```markdown
# <Change name>

**Spec:** [domain.md](../specs/domain.md) <!-- or: none — new domain, spec written alongside this plan -->
**Status:** Draft | Active
**Last Updated:** <date>

## 1. Goal

One paragraph: what this change delivers. Link to the spec for why it matters — don't restate it.

## 2. Approach

The chosen implementation approach in a few paragraphs. Keep this to execution-level
tradeoffs (ordering, tooling, mechanics). Any enduring alternative analysis — a rejected
design, a boundary choice — goes into the spec's Design Decisions immediately, not here.

## 3. Affected code

| File                  | Change               |
| --------------------- | -------------------- |
| `path/to/new/file.ts` | New: description     |
| `path/to/existing.ts` | Modify: what changes |

File trees for new module structure are welcome here.

## 4. Data model / type changes

Concrete DDL migrations, new/changed type signatures, config keys. Implementation-level
detail — the contract-level shape belongs in the spec.

## 5. Implementation phases

### Phase 1: <name>

- [ ] Task
- [ ] Task

### Phase 2: <name>

- [ ] Task

Sequence phases so each is independently buildable and testable. Earlier phases must not
depend on later ones.

## 6. Test plan

What will be tested and where — new test files, extended suites, manual verification steps.

## 7. Risks & open questions

- Implementation risks with mitigations
- Unresolved questions blocking phases (move durable domain questions to the spec)
```

4. Omit sections that genuinely don't apply (a pure refactor may have no data model changes) — but Goal, Affected code, and Implementation phases are always required.

### RETIRE_PLAN

Run when the change has shipped and is verified working.

1. **Harvest into the spec** (via SPEC_SKILL): new design decisions and rationale, contract changes (schema, API, CLI), discovered non-goals, resolved or newly raised open questions. Update the spec's status if the plan implemented a Planned spec.
2. **Verify delegation:** confirm the code and tests actually cover what the plan described — phases complete, test plan realized. A plan retired with unshipped phases is a scope cut; record the cut work as spec Open Questions or new tasks, not by keeping the plan.
3. **Delete the plan file.** Do not archive it, rename it to `done-`, or mark it implemented. Git history preserves it; the spec preserves what mattered.

## Constraints

- Plans are ephemeral. Never keep a plan after its change ships — RETIRE_PLAN ends in deletion, always.
- Never restate spec content in a plan; link to the spec. Rationale that should outlive the change goes in the spec, not the plan.
- One plan per change. Don't grow a plan into a multi-feature roadmap — split it.
- Never plan against imagined code structure; read the affected code first.
- A Draft plan with unresolved approach questions must not be sliced into AFK tasks — settle the approach (or front-load HITL decision tasks) first.
- Once TASKS_SKILL has generated tasks from a plan, the task index owns sequencing; stop maintaining the plan's phase checklists.

## Validation

For a written or updated plan:

- [ ] Named after the change, kebab-case, in PLANS_DIR
- [ ] Links to its domain spec (or states the spec is being written alongside)
- [ ] Goal, Affected code, and Implementation phases sections present
- [ ] Phases are independently buildable and verifiable
- [ ] No rationale/boundary content that belongs in the spec
- [ ] Durable decisions surfaced while planning were recorded in the spec

For a retired plan:

- [ ] A domain spec exists (created via SPEC_SKILL if the plan started without one)
- [ ] Spec updated with harvested decisions and contract changes
- [ ] Code and tests cover what the plan described, or cut scope is recorded elsewhere
- [ ] Plan file deleted (not archived or renamed)

# Spec Authoring Guide

Specs describe a stable system boundary: why it exists, what it contains, what it excludes, and how it should evolve as code changes.

Root specs live in `devflow/specs/` and are the current source of truth. Active feature work stages new specs and changes to existing specs under `devflow/feat/<feat-name>/specs/` until the feature ships.

## Variables

| Variable                              | Value                             | Notes                                                      |
| ------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| DEVFLOW_DIR                           | `devflow/`                        | Planning workspace root                                    |
| ROOT_SPECS                            | `devflow/specs/`                  | Durable current specs                                      |
| DEVFLOW_README                        | `devflow/README.md`               | Index into root specs and workspace structure              |
| FEATURE_DIR                           | `devflow/feat/<feat-name>/`       | Active feature folder                                      |
| FEATURE_SPECS                         | `devflow/feat/<feat-name>/specs/` | New specs and deltas staged by a feature                   |
| [rfc-authoring](./rfc-authoring.md)   | `rfc-authoring`                   | Companion reference for pre-feature decision records       |
| [plan-authoring](./plan-authoring.md) | `plan-authoring`                  | Companion reference for feature-local implementation plans |
| [task-authoring](./task-authoring.md) | `task-authoring`                  | Companion reference for feature-local AFK task queues      |

## Prerequisites

- The feature or system being specified has a clear scope.
- Accepted RFCs relevant to the domain have been read, if they exist.
- If updating an existing spec, read the current root spec and its referenced modules first.
- If drafting for an active feature, read `proposal.md`, the feature plan if present, and relevant feature-local spec files.
- Read the actual code before writing or updating specs for implemented behavior.

## Knowledge

### Root specs vs feature-local specs

Use root specs for the current durable contract. Use feature-local specs for pending feature changes.

| Location                                         | Use for                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `devflow/specs/<spec-name>.md`                   | Current durable domain spec                                               |
| `devflow/feat/<feat-name>/specs/<new>.md`        | New spec drafted by a feature before promotion                            |
| `devflow/feat/<feat-name>/specs/<name>.delta.md` | Pending changes to an existing root spec, to merge when the feature ships |

A delta file should state only what changes relative to the root spec. Do not duplicate the entire root spec unless the feature is replacing it wholesale.

### Code-first principle

Specs describe intent informed by reality. Code is the source of truth for what exists; specs capture why it exists, what boundary it belongs to, and what should not change accidentally. Never write a spec from memory or assumption — read the code first when documenting implemented behavior.

### Document split

| Document         | Owns                                                              | Lifetime                       |
| ---------------- | ----------------------------------------------------------------- | ------------------------------ |
| RFC              | Idea framing, alternatives, tradeoffs, recommendation, decision   | Durable historical record      |
| Root spec        | Current durable contracts, boundaries, rationale, non-goals       | Permanent, evolves with domain |
| Feature proposal | Problem framing, goals, scope, links to decisions                 | Archived with feature          |
| Feature spec     | New specs or deltas to merge into root specs                      | Promoted/merged, then archived |
| Feature plan     | Build strategy, phases, validation, task context, developer notes | Archived with feature          |
| Task queue       | Detailed AFK slices and acceptance checks                         | Archived with feature          |
| Code + tests     | What exists and how it behaves                                    | Ground truth                   |

A spec may link to accepted RFCs for decision history, but it records only the durable domain outcome. It should not copy the RFC's full alternatives table or proposal debate. Implementation strategy belongs in the feature plan, and exact execution details belong in task files.

### Domain naming

A root spec names a stable system boundary, not a feature request or delivery task.

Good names:

- `auth-system`
- `task-engine`
- `data-pipeline`

Bad names:

- `add-priority-filter`
- `spec-003`
- `phase-2-redesign`

Feature-local deltas use the root spec name plus `.delta.md`, for example `task-engine.delta.md`.

### Module-level code references

A spec references code at module/package granularity, never per-file. The reader who needs file-level detail should open the module README or the code itself.

| Reference                                                    | Allowed in spec?  |
| ------------------------------------------------------------ | ----------------- |
| `packages/pithos` (module root)                              | Yes               |
| "the engine module" (named concept the module README maps)   | Yes               |
| `packages/pithos/src/engine.ts` (individual file)            | No                |
| Per-file tables ("Code Locations", testing file inventories) | No                |
| Test directory pointer (`packages/pithos/test/`)             | Yes, one line max |

Feature plans and task files may name exact files when needed. Specs should not.

### Spec status values

- **Draft** — initial write-up, may not reflect code accurately yet
- **Planned** — intended contracts for a system not yet built
- **Implemented** — spec matches the code
- **Partial** — some sections are implemented, others remain planned
- **Deprecated** — system is being replaced or removed

A Planned spec has the same density as an Implemented one: intended contracts and rationale, not build instructions.

### What specs are for

Specs capture things code cannot:

| Spec captures                  | Code captures                |
| ------------------------------ | ---------------------------- |
| Why this design was chosen     | What the design is           |
| What was explicitly rejected   | What was built               |
| Non-goals and scope boundaries | Current behavior             |
| Cross-system tradeoffs         | Local implementation details |
| External API contracts         | Internal types and functions |
| Domain concepts and invariants | Mechanics that enforce them  |

## Decisions

Entry state: DETERMINE_MODE

### DETERMINE_MODE

- guard: user wants a new durable current spec → WRITE_ROOT_SPEC
- guard: user wants to update a current durable spec outside active feature staging → UPDATE_ROOT_SPEC
- guard: user wants spec changes for an active feature → WRITE_FEATURE_SPEC_OR_DELTA
- guard: user wants to merge shipped feature spec changes into current specs → PROMOTE_FEATURE_SPECS
- guard: user wants idea exploration or tradeoff decision → redirect to [rfc-authoring](./rfc-authoring.md)
- guard: user wants implementation strategy or phases → redirect to [plan-authoring](./plan-authoring.md)
- guard: user wants execution slices → redirect to [task-authoring](./task-authoring.md)

### WRITE_ROOT_SPEC

- action: write a root spec per Procedures
- action: update `devflow/README.md` spec index
- always → DONE

### UPDATE_ROOT_SPEC

- action: update the root spec in place
- action: update `devflow/README.md` if the spec index, status, or module mapping changed
- always → DONE

### WRITE_FEATURE_SPEC_OR_DELTA

- guard: changing an existing root spec → write `devflow/feat/<feat-name>/specs/<spec-name>.delta.md`
- guard: introducing a new domain spec for the feature → write `devflow/feat/<feat-name>/specs/<spec-name>.md`
- action: link from the feature plan/proposal when present
- always → DONE

### PROMOTE_FEATURE_SPECS

- action: merge deltas into `devflow/specs/` and promote new specs
- action: update `devflow/README.md` spec index
- always → DONE

### DONE

- terminal state

## Procedures

### WRITE_ROOT_SPEC

1. Read accepted RFCs, existing root specs, relevant feature folders, and code for implemented behavior.
2. Create `devflow/specs/` if it does not exist.
3. Create `devflow/specs/<stable-domain-name>.md`.
4. Run `devflow-ids next SPEC <name> devflow` from `../scripts/devflow-ids.nu` when available; otherwise scan existing root, feature, and archived specs before choosing the next globally unused spec document ID.
5. Write the lightest spec that captures the boundary using the root spec section in `./spec-authoring.template.md`, including the document ID and document-prefixed sub IDs for sections and list/table items.
6. Omit sections that genuinely do not apply, but Purpose, Goals, Non-goals, and Design decisions are expected for most specs.
7. Add or update the spec row in `devflow/README.md`.

### UPDATE_ROOT_SPEC

1. Read the root spec, relevant code, accepted RFCs, and feature archive context if it explains the change.
2. Update only durable current knowledge: contracts, rationale, non-goals, design decisions, status, and open questions.
3. Remove stale planned text once it no longer describes the current contract.
4. Keep file references at module level.
5. Update `devflow/README.md` if index data changed.

### WRITE_FEATURE_SPEC_OR_DELTA

1. Read `devflow/feat/<feat-name>/proposal.md`, the feature plan if present, relevant root specs, RFCs, and code.
2. Create `devflow/feat/<feat-name>/specs/` if needed.
3. Run `devflow-ids next DELTA <name> devflow` from `../scripts/devflow-ids.nu` when available; otherwise scan existing root, feature, and archived specs before choosing the next globally unused delta document ID.
4. For an existing root spec, create `devflow/feat/<feat-name>/specs/<spec-name>.delta.md` using the feature delta section in `./spec-authoring.template.md`.
5. For a new feature-owned spec, use the root spec format in `devflow/feat/<feat-name>/specs/<spec-name>.md` and mark status Planned or Draft.
6. Preserve existing reference IDs when editing; append new IDs rather than renumbering unless the spec is still a draft with no external references.
7. Link the file from the feature plan/proposal when present.

### PROMOTE_FEATURE_SPECS

1. Read all files in `devflow/feat/<feat-name>/specs/` plus relevant root specs.
2. For each `*.delta.md`, merge durable changes into the matching root spec and mark the delta Merged.
3. For each new spec, move or copy the durable current version into `devflow/specs/` and set the appropriate root spec status.
4. Update `devflow/README.md` with promoted specs and status changes.
5. Leave the feature-local copies in place for archive history when the feature folder is moved.

## Constraints

- Root specs are the current source of truth; archived feature folders are historical context.
- Do not put implementation phases, task checklists, or per-file code maps in specs.
- Do not duplicate RFC alternatives or feature proposal narrative in specs.
- Feature deltas are temporary staging for pending contract changes; merge shipped outcomes into root specs.
- Prefer minimal specs and grow only when the domain needs more explanation.

## Validation

For root specs:

- [ ] File lives in `devflow/specs/`
- [ ] Name describes a stable domain boundary
- [ ] Status is valid
- [ ] Module-level code pointer only
- [ ] Durable contracts and design decisions are captured
- [ ] Document has a stable `SPEC-<name>-<nnn>[@<version>]` ID
- [ ] Sections and list/table items have stable document-prefixed sub IDs
- [ ] No implementation phases, task checklists, file trees, or test inventories
- [ ] `devflow/README.md` index is updated

For feature specs/deltas:

- [ ] File lives in `devflow/feat/<feat-name>/specs/`
- [ ] Existing spec changes use `<spec-name>.delta.md`
- [ ] Delta states only changes relative to the root spec
- [ ] Document has a stable `DELTA-<name>-<nnn>[@<version>]` ID
- [ ] Sections and list/table items have stable document-prefixed sub IDs
- [ ] New specs are ready to promote into `devflow/specs/` when the feature ships
- [ ] Feature plan/proposal links are updated when present

# Proposal Authoring Guide

A proposal is the feature-local problem framing that starts an active devflow feature folder. It defines why the feature exists and what product/domain scope it owns, before implementation planning or task slicing.

Proposals live at `devflow/feat/<feat-name>/proposal.md`.

## Variables

| Variable                              | Value                                  | Notes                                                |
| ------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| DEVFLOW_DIR                           | `devflow/`                             | Planning workspace root                              |
| FEATURE_DIR                           | `devflow/feat/<feat-name>/`            | Active feature folder                                |
| PROPOSAL_FILE                         | `devflow/feat/<feat-name>/proposal.md` | Feature-local problem framing and scope              |
| FEATURE_SPECS                         | `devflow/feat/<feat-name>/specs/`      | New specs and deltas staged by this feature          |
| ROOT_SPECS                            | `devflow/specs/`                       | Durable specs linked when relevant                   |
| [rfc-authoring](./rfc-authoring.md)   | `rfc-authoring`                        | Companion reference for unresolved direction choices |
| [spec-authoring](./spec-authoring.md) | `spec-authoring`                       | Companion reference for durable contract changes     |
| [plan-authoring](./plan-authoring.md) | `plan-authoring`                       | Converts accepted proposal scope into a build plan   |

## Prerequisites

- The user has described a feature, fix, refactor, or substantial change with enough scope to name a feature folder.
- The feature name is known or can be inferred safely as kebab-case `<feat-name>`.
- Relevant root specs, RFCs, and code have been read when they affect problem framing or scope.

## Knowledge

### What proposals own

| Document         | Owns                                                         | Does not own                                    |
| ---------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Feature proposal | Problem framing, goals, non-goals, scope, links to decisions | Implementation strategy, phase breakdown, tasks |
| RFC              | Alternatives, tradeoffs, recommendation, accepted decisions  | Current feature status or task tracking         |
| Root spec        | Durable current domain contracts and rationale               | Feature-local sequencing                        |
| Feature plan     | Build strategy, phases, validation, task context, dev notes  | Product problem framing                         |
| Task files       | Exact execution slices, acceptance criteria, dependencies    | Durable design rationale                        |

A proposal should link to accepted RFCs and relevant root specs. It should not duplicate RFC alternatives or speculate about implementation mechanics.

## Procedures

### WRITE_PROPOSAL

1. Choose a kebab-case `<feat-name>` from the user's request; ask if ambiguous.
2. Create `devflow/feat/<feat-name>/` and `devflow/feat/<feat-name>/specs/` if needed.
3. Write `devflow/feat/<feat-name>/proposal.md` using `./proposal-authoring.template.md`, including the document ID and document-prefixed sub IDs for sections and list/table items.
4. If the proposal exposes unresolved alternatives, use [rfc-authoring](./rfc-authoring.md) before planning.
5. If the proposal changes durable contracts, use [spec-authoring](./spec-authoring.md) for feature-local spec deltas.

## Constraints

- Keep implementation strategy out of `## Proposed scope`; it belongs in the feature plan.
- Ask for the feature name or ownership when ambiguous; do not invent one for unclear multi-feature requests.
- Do not copy RFC alternatives into the proposal; link to the RFC.
- Keep the proposal short enough to orient future plan/task authors quickly.
- Preserve existing reference IDs when editing; append new IDs rather than renumbering unless the document is still a draft with no external references.

## Validation

- [ ] File lives at `devflow/feat/<feat-name>/proposal.md`
- [ ] Feature folder and `specs/` staging folder exist
- [ ] Problem, goals, non-goals, proposed scope, and open questions are present
- [ ] Document has a stable sequential `PROP-<nnn>` ID
- [ ] Sections and list/table items have stable document-prefixed sub IDs
- [ ] Relevant RFCs and root specs are linked or explicitly marked `None`
- [ ] Proposed scope avoids implementation phases and task detail

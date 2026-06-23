# <Feature name> Plan

**Document ID:** `PLAN-<nnn>`
**Feature:** `<feat-name>`
**Proposal:** [proposal.md](./proposal.md)
**RFC:** [title](../rfcs/YYYY-MM-DD-slug.md) <!-- or: none -->
**Root specs:** [domain.md](../specs/domain.md) <!-- or: none yet -->
**Feature specs:** [specs/domain.delta.md](./specs/domain.delta.md) <!-- or: none -->
**Status:** Draft | Reviewed | Active | Shipped | Abandoned
**Last Updated:** <YYYY-MM-DD>
**Configuration identification:** Use the next stable sequential plan document ID, for example `PLAN-001`. Prefix every nested point ID with that document ID, for example `PLAN-001.P1` or `PLAN-001.PH1`, so references are globally grepable and do not clash across documents. If the next number is unclear, ask before creating the plan.

## PLAN-<nnn>.P1 Goal and scope

One paragraph: what this feature delivers. Link to the proposal/spec for why it matters.

## PLAN-<nnn>.P2 Approach

- **PLAN-<nnn>.A1:** Chosen implementation strategy, architecture, sequencing, integration boundaries, and important mechanics.

## PLAN-<nnn>.P3 Affected areas

| ID             | Area                | Expected change                                                 |
| -------------- | ------------------- | --------------------------------------------------------------- |
| PLAN-<nnn>.AA1 | `module/or/package` | High-level change                                               |
| PLAN-<nnn>.AA2 | `key/file.ts`       | Only include specific files when they are architectural anchors |

## PLAN-<nnn>.P4 Contract and migration impact

- **PLAN-<nnn>.CM1:** High-level data model, API, CLI, config, or migration impact. Durable contract changes belong in feature-local spec deltas or new specs, not only here.

## PLAN-<nnn>.P5 Implementation phases

### PLAN-<nnn>.PH1 <name>

Outcome: <reviewable outcome this phase delivers>

### PLAN-<nnn>.PH2 <name>

Outcome: <reviewable outcome this phase delivers>

## PLAN-<nnn>.P6 Validation strategy

- **PLAN-<nnn>.V1:** What must be proven before the change is trusted.

## PLAN-<nnn>.P7 Risks and open questions

- **PLAN-<nnn>.R1:** Implementation risk with mitigation.
- **PLAN-<nnn>.Q1:** Open question blocking task generation.

## PLAN-<nnn>.P8 Task context

- **PLAN-<nnn>.TC1:** Brief context task authors and AFK agents need, including important references.

## PLAN-<nnn>.P9 Developer Notes

Append notes here. Do not rewrite earlier notes.

### PLAN-<nnn>.DN1 Task <id>: <description> — <YYYY-MM-DD>

- Note relevant for later agents or follow-up scope.

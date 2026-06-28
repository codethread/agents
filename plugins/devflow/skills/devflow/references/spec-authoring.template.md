## Root spec template

# <Domain name>

**Document ID:** `SPEC-<nnn>`
**Status:** Draft | Planned | Implemented | Partial | Deprecated
**Last Updated:** <YYYY-MM-DD>
**Related RFCs:** <links or "None">
**Code:** <module/package root or "Not implemented yet">
**Configuration identification:** Use the next globally unused stable sequential spec document ID, for example `SPEC-001`; prefer `devflow-ids next SPEC devflow` from `../scripts/devflow-ids.nu` when available. Prefix every nested point ID with that document ID, for example `SPEC-001.P1` or `SPEC-001.IC1`, so references are globally grepable and do not clash across documents. If the next number is unclear, ask before creating the spec.

## SPEC-<nnn>.P1 Purpose

Why this system exists.

## SPEC-<nnn>.P2 Goals

- **SPEC-<nnn>.G1:** Durable outcome this domain must support.

## SPEC-<nnn>.P3 Non-goals

- **SPEC-<nnn>.NG1:** Boundary intentionally outside this domain.

## SPEC-<nnn>.P4 Domain concepts

- **SPEC-<nnn>.DC1:** Concept needed to understand the boundary.

## SPEC-<nnn>.P5 Interfaces and contracts

- **SPEC-<nnn>.IC1:** Durable API, schema, CLI contract, data contract, or invariant.

## SPEC-<nnn>.P6 Design decisions

### SPEC-<nnn>.D1 <Decision>

- **Decision:** What is true.
- **Rationale:** Why.
- **Rejected:** Alternatives intentionally not chosen.

## SPEC-<nnn>.P7 Open questions

- **SPEC-<nnn>.Q1:** Unresolved durable question, if any.

## Feature spec delta template

# <Spec name> delta for <feature name>

**Document ID:** `DELTA-<nnn>`
**Root spec:** [<spec-name>.md](../../specs/<spec-name>.md)
**Feature:** [../proposal.md](../proposal.md)
**Status:** Draft | Reviewed | Merged
**Last Updated:** <YYYY-MM-DD>
**Configuration identification:** Use the next globally unused stable sequential delta document ID, for example `DELTA-001`; prefer `devflow-ids next DELTA devflow` from `../scripts/devflow-ids.nu` when available. Prefix every nested point ID with that document ID, for example `DELTA-001.P1` or `DELTA-001.CC1`, so references are globally grepable and do not clash across documents. If the next number is unclear, ask before creating the delta.

## DELTA-<nnn>.P1 Summary

What changes relative to the root spec.

## DELTA-<nnn>.P2 Contract changes

- **DELTA-<nnn>.CC1:** Durable behavior, API, schema, CLI, or invariant change.

## DELTA-<nnn>.P3 Design decisions

### DELTA-<nnn>.D1 <Decision>

- **Decision:** What will become true if the feature ships.
- **Rationale:** Why.
- **Rejected:** Alternatives intentionally not chosen.

## DELTA-<nnn>.P4 Open questions

- **DELTA-<nnn>.Q1:** Question blocking promotion or implementation.

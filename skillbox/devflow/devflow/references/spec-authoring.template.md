## Root spec template

# <Domain name>

**Document ID:** `SPEC-<name>-<nnn>[@<version>]`
**Status:** Draft | Planned | Implemented | Partial | Deprecated
**Last Updated:** <YYYY-MM-DD>
**Related RFCs:** <links or "None">
**Code:** <module/package root or "Not implemented yet">
**Configuration identification:** Document IDs must be ordered as document type, short name, sequential id, then optional version: `SPEC-Dwr-001` for v1 and `SPEC-Dwr-001@2` for v2. Omit `@1`; append `@2`, `@3`, etc. only when a new version supersedes an externally referenced document. Prefix every nested point ID with the full document ID, for example `SPEC-Dwr-001.P1` or `SPEC-Dwr-001@2.P1`, so references are globally grepable and do not clash across documents. If the next number or version is unclear, ask before creating the document.

## SPEC-<name>-<nnn>.P1 Purpose

Why this system exists.

## SPEC-<name>-<nnn>.P2 Goals

- **SPEC-<name>-<nnn>.G1:** Durable outcome this domain must support.

## SPEC-<name>-<nnn>.P3 Non-goals

- **SPEC-<name>-<nnn>.NG1:** Boundary intentionally outside this domain.

## SPEC-<name>-<nnn>.P4 Domain concepts

- **SPEC-<name>-<nnn>.DC1:** Concept needed to understand the boundary.

## SPEC-<name>-<nnn>.P5 Interfaces and contracts

- **SPEC-<name>-<nnn>.IC1:** Durable API, schema, CLI contract, data contract, or invariant.

## SPEC-<name>-<nnn>.P6 Design decisions

### SPEC-<name>-<nnn>.D1 <Decision>

- **Decision:** What is true.
- **Rationale:** Why.
- **Rejected:** Alternatives intentionally not chosen.

## SPEC-<name>-<nnn>.P7 Open questions

- **SPEC-<name>-<nnn>.Q1:** Unresolved durable question, if any.

## Feature spec delta template

# <Spec name> delta for <feature name>

**Document ID:** `DELTA-<name>-<nnn>[@<version>]`
**Root spec:** [<spec-name>.md](../../specs/<spec-name>.md)
**Feature:** [../proposal.md](../proposal.md)
**Status:** Draft | Reviewed | Merged
**Last Updated:** <YYYY-MM-DD>
**Configuration identification:** Document IDs must be ordered as document type, short name, sequential id, then optional version: `DELTA-Dwr-001` for v1 and `DELTA-Dwr-001@2` for v2. Omit `@1`; append `@2`, `@3`, etc. only when a new version supersedes an externally referenced document. Prefix every nested point ID with the full document ID, for example `DELTA-Dwr-001.P1` or `DELTA-Dwr-001@2.P1`, so references are globally grepable and do not clash across documents. If the next number or version is unclear, ask before creating the document.

## DELTA-<name>-<nnn>.P1 Summary

What changes relative to the root spec.

## DELTA-<name>-<nnn>.P2 Contract changes

- **DELTA-<name>-<nnn>.CC1:** Durable behavior, API, schema, CLI, or invariant change.

## DELTA-<name>-<nnn>.P3 Design decisions

### DELTA-<name>-<nnn>.D1 <Decision>

- **Decision:** What will become true if the feature ships.
- **Rationale:** Why.
- **Rejected:** Alternatives intentionally not chosen.

## DELTA-<name>-<nnn>.P4 Open questions

- **DELTA-<name>-<nnn>.Q1:** Question blocking promotion or implementation.

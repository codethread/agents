---
name: spec-authoring
description: >
  Guide for writing and maintaining domain specifications that drive agent implementation.
  Use when creating a new spec, updating an existing spec after feature changes, converting
  a planned spec to implemented status, or reviewing spec quality. Triggers on phrases like
  "create a spec", "write a spec", "update the spec", "spec for this feature", "plan this
  feature", or any request to document a system's design intent, architecture, and decisions
  before or during implementation.
---

# Spec Authoring Guide

Specs are persistent design documents that drive and record implementation decisions. They are written **before** code to guide agents, then evolve alongside the code as the system matures. A spec's value comes from capturing _intent_ and _rationale_ — things code cannot express.

## Variables

| Variable       | Value                | Notes                                       |
| -------------- | -------------------- | ------------------------------------------- |
| SPECS_DIR      | `specs/`             | Root directory for all spec files           |
| DISCOVERY_FILE | `specs/discovery.md` | Cross-cutting learnings shared across specs |
| SPECS_README   | `specs/README.md`    | Index table linking specs to code           |

## Prerequisites

- The feature or system being specified has a clear scope
- If updating an existing spec, read the current spec and its referenced code locations first
- Check DISCOVERY_FILE for cross-cutting notes that may affect the design

## Knowledge

### The spec lifecycle

```
Planned → In Progress → Implemented → (continues evolving)
```

- **Planned**: Spec written before any code. Maximum detail in Architecture, Data Model, Interfaces, and Implementation Phases. This is the blueprint the agent builds from.
- **In Progress**: Code is being written. Spec is the source of truth for intent; code is the source of truth for implementation details.
- **Implemented**: Code exists and works. Spec evolves to focus on _why_ over _how_. Architecture and Data Model sections slim down to summaries pointing at code. Implementation Phases become a Testing section.

### What specs are for

Specs capture things code cannot:

| Spec captures                  | Code captures                |
| ------------------------------ | ---------------------------- |
| Why this design was chosen     | What the design is           |
| What was explicitly rejected   | What was built               |
| Non-goals and scope boundaries | Current behavior             |
| Cross-system tradeoffs         | Local implementation details |
| External API contracts upfront | Internal types and functions |
| Implementation sequencing      | Final structure              |

### What specs are NOT for

- **Restating type definitions** — If a TypeScript interface or Rust struct is self-documenting, don't transcribe it into the spec. Reference the file instead.
- **Listing test assertions in prose** — Well-named `describe`/`it` blocks communicate this better than spec bullet points.
- **Full function implementations** — Code belongs in code files. Specs can show key signatures, schemas, and API shapes, but not complete implementations.
- **Explaining standard concepts** — Don't teach the agent what git, HTTP, or encryption is. Document _your specific application_ of these concepts.

### Section density by lifecycle stage

| Section               | Planned (high detail)         | Implemented (summary + pointers)       |
| --------------------- | ----------------------------- | -------------------------------------- |
| Overview              | Full                          | Full                                   |
| Design Decisions      | Full                          | Full (most valuable section long-term) |
| Architecture          | Component diagrams, file maps | Summary pointing to code               |
| Data Model            | Full schemas, key types       | Summary pointing to code               |
| Interfaces            | Full API contracts            | Summary pointing to code               |
| Implementation Phases | Sequenced checklist           | Replace with Testing section           |
| Code Locations        | Files to create/modify        | Files that exist                       |
| Open Questions        | Active                        | Resolved or remaining                  |

### Design Decisions: the highest-value section

Every non-obvious choice gets its own entry with explicit rationale. This is what agents need most when modifying existing code — understanding _why_ something is the way it is prevents accidental design regression.

Format:

```markdown
- **Decision:** Discovery uses `DefaultPackageManager.resolve(...)` instead of manual parsing.
  - **Rationale:** It exactly matches the real extension/package discovery rules, including package manifests, precedence, and path filters.
```

Good decisions to document:

- Why one approach was chosen over alternatives
- Why a dependency was or wasn't used
- Why a particular scope/boundary was drawn
- Security or performance tradeoffs
- Caching, injection, or lifecycle strategies

### When to include concrete artifacts

Include copy-pasteable artifacts when they carry **design intent** an agent couldn't derive from context:

| Artifact                | Include in spec?                                    |
| ----------------------- | --------------------------------------------------- |
| SQL schema DDL          | Yes — defines the data contract                     |
| API endpoint tables     | Yes — defines the interface contract                |
| CLI flag definitions    | Yes — defines the user contract                     |
| K8s RBAC/manifests      | Yes — infrastructure intent an agent wouldn't guess |
| Rust/TS type signatures | Only key types; link to code for full definitions   |
| Full function bodies    | No — code is the truth                              |
| Config env vars table   | Yes — operational contract                          |
| External API details    | Yes — domain knowledge agents lack                  |

## Decisions

Entry state: DETERMINE_MODE

### DETERMINE_MODE

- guard: user wants a new spec for unbuilt feature → WRITE_PLANNING_SPEC
- guard: user wants to update a spec after code changes → UPDATE_TO_LIVING_SPEC
- guard: user wants to create a spec for existing undocumented code → WRITE_LIVING_SPEC
- guard: user wants to review/improve an existing spec → REVIEW_SPEC

### WRITE_PLANNING_SPEC

- action: write a full planning spec per Procedures
- always → REGISTER_IN_INDEX

### UPDATE_TO_LIVING_SPEC

- action: read current spec and code, slim down per Procedures
- always → REGISTER_IN_INDEX

### WRITE_LIVING_SPEC

- action: read the code first, then write a living spec per Procedures
- always → REGISTER_IN_INDEX

### REVIEW_SPEC

- action: evaluate the spec against the quality checklist in Validation
- guard: spec needs changes → apply fixes, then → REGISTER_IN_INDEX
- guard: spec is good → DONE

### REGISTER_IN_INDEX

- action: ensure SPECS_README has an entry for this spec with Purpose and Code columns
- action: if cross-cutting learnings emerged, append to DISCOVERY_FILE
- always → DONE

### DONE

- terminal state

## Procedures

### WRITE_PLANNING_SPEC

Write all sections at full detail. This is the blueprint an agent will implement from.

1. Create file in SPECS_DIR with kebab-case name matching the system area
2. Add frontmatter: `**Status:** Planned`, `**Last Updated:** <date>`
3. Write sections in this order:

#### Section 1: Overview

```markdown
## 1. Overview

### Purpose

One paragraph: what this system does and why it exists.

### Goals

Bulleted list of concrete, verifiable outcomes.

### Non-Goals

Bulleted list of things explicitly out of scope. Be specific — "not X" is more useful than "simple".
```

#### Section 2: Design Decisions

```markdown
## 2. Design Decisions

- **Decision:** <what was chosen>
  - **Rationale:** <why, including what alternatives were rejected>
```

Place this early (section 2) so the agent internalizes constraints before reading architecture details.

#### Section 3: Architecture

```markdown
## 3. Architecture

### Component structure

File tree or crate/module map showing what will be created.

### Data flow

ASCII diagram or numbered flow showing how data moves through the system.
```

Include concrete file paths, crate names, module structure. The agent needs to know _where_ to put things.

#### Section 4: Data Model

```markdown
## 4. Data Model

### Database schema (if applicable)

Full SQL DDL — this is a design contract, not documentation.

### Core types

Key type signatures. Only types that define the domain contract; skip internal helpers.
```

#### Section 5: Interfaces

```markdown
## 5. Interfaces

### API endpoints (if applicable)

Method | Path | Description table.

### CLI flags / Commands (if applicable)

Flag | Description | Default table.

### Events / Hooks (if applicable)

Event name, payload shape, behavioral contract.
```

Include request/response examples for non-obvious APIs.

#### Section 6: Implementation Phases

```markdown
## 6. Implementation Phases

### Phase 1: <name> (<time estimate>)

- [ ] Task 1
- [ ] Task 2

### Phase 2: <name> (<time estimate>)

- [ ] Task 3
```

Sequence phases so each can be built and tested independently. Earlier phases should not depend on later ones.

#### Section 7: Code Locations

```markdown
## 7. Code Locations

| File                  | Change               |
| --------------------- | -------------------- |
| `path/to/new/file.ts` | New: description     |
| `path/to/existing.ts` | Modify: what changes |
```

#### Section 8: Open Questions

```markdown
## 8. Open Questions

- Should X support Y? (tradeoff: complexity vs flexibility)
- Is Z the right default? (alternative: W)
```

### UPDATE_TO_LIVING_SPEC

Transition a spec from Planned/In Progress to Implemented. The goal is to keep what code _can't_ express and remove what it _already_ expresses.

1. Change status to `**Status:** Implemented`
2. Update `**Last Updated:**` date
3. **Keep at full detail:** Overview, Design Decisions, Open Questions
4. **Slim Architecture to summary:** Replace detailed file trees with a one-line description + pointer to the code directory. Keep ASCII diagrams only if they show cross-component flow.
5. **Slim Data Model:** Remove type transcriptions. Keep SQL schemas (they're the contract). For code types, write "See `path/to/types.ts`".
6. **Slim Interfaces:** Keep API endpoint tables and CLI flag tables (they're contracts). Remove behavioral prose that restates test assertions.
7. **Replace Implementation Phases with Testing:**

   ```markdown
   ## Testing

   Automated tests in:

   - `path/to/foo.test.ts` — integration tests for X
   - `path/to/bar.test.ts` — unit tests for Y

   Manual verification: description of any manual testing needed.
   ```

8. **Update Code Locations** to reflect actual file paths (remove the "Change" column, just list paths)

### WRITE_LIVING_SPEC

For existing code that has no spec. Read the code first, then work backwards.

1. Read all source files for the system
2. Identify the non-obvious decisions — anything where the code's _what_ doesn't explain the _why_
3. Write the spec following the living-spec density (see Knowledge table)
4. Prioritize Design Decisions — interview the user if rationale isn't clear from code

### Updating SPECS_README

The index table groups specs by domain area. Each entry has:

```markdown
| [spec-name.md](./spec-name.md) | One-line purpose | `code/path/` |
```

If adding a new domain area, create a new table section with an `##` heading.

## Constraints

- **Specs describe intent, code describes reality.** When they conflict, the code is correct and the spec needs updating.
- **Never transcribe entire type definitions or function bodies into specs.** Reference the file.
- **Design Decisions must have rationale.** A decision without a "why" is useless — the agent can read _what_ from the code.
- **Non-Goals are mandatory.** Unbounded specs lead to unbounded implementations.
- **Keep specs under 400 lines for simple systems, under 800 for complex ones.** If a spec exceeds this, it's either covering too much scope or restating code. Exception: planning specs for large multi-component systems (like a secrets system with crypto, K8s integration, and multi-crate structure) may legitimately need more.
- **One spec per system area.** Don't split a single system across multiple specs. Don't combine unrelated systems into one spec.
- **Always update the index.** A spec not in SPECS_README effectively doesn't exist for discovery.

## Validation

Before considering a spec complete, verify:

- [ ] Status and Last Updated are set correctly
- [ ] Overview has Purpose, Goals, and Non-Goals
- [ ] Design Decisions section exists with at least one decision + rationale
- [ ] No full function implementations appear in the spec
- [ ] No type definitions are transcribed verbatim when the code file could be referenced instead
- [ ] Architecture section has file/module structure (planning) or code pointers (living)
- [ ] Code Locations section exists and paths are accurate
- [ ] SPECS_README index includes an entry for this spec
- [ ] Spec line count is proportionate to system complexity (not a 1:1 mirror of code)
- [ ] Cross-cutting learnings (if any) are added to DISCOVERY_FILE

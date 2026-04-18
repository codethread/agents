---
name: spec-authoring
description: >
  Guide for writing and updating domain specifications. Use when creating a new spec,
  updating an existing spec, converting planned spec to implemented, or reviewing spec
  quality. Triggers on: "write spec", "update spec", "spec this", "review spec".
metadata:
  intent: >-
    drive consistent domain specs that capture intent, rationale, and boundaries code alone cannot express
---

# Spec Authoring Guide

Specs are persistent domain documents that describe a system boundary: why it exists, what it contains, what it excludes, and how it should evolve as code changes. They are written from the code outward, with code as reality and the spec as the durable statement of intent, rationale, and boundaries.

## Variables

| Variable     | Value             | Notes                             |
| ------------ | ----------------- | --------------------------------- |
| SPECS_DIR    | `specs/`          | Root directory for all spec files |
| SPECS_README | `specs/README.md` | Index table linking specs to code |

## Prerequisites

- The feature or system being specified has a clear scope
- If updating an existing spec, read the current spec and its referenced code locations first
- Read the actual code before writing or updating a spec

## Knowledge

### Code-first principle

Specs describe intent informed by reality. Code is the source of truth for what exists; specs capture why it exists, what boundary it belongs to, and what should not change accidentally. Never write a spec from memory or assumption — read the code first.

### Domain naming

A spec names a stable system boundary, not a feature request or delivery task.

Good names:

- `auth-system`
- `task-engine`
- `data-pipeline`

Bad names:

- `add-priority-filter`
- `spec-003`
- `phase-2-redesign`

If the user gives a feature name, identify which domain it belongs to before naming the spec.

### Spec sizing

Choose the lightest spec shape that still captures the boundary clearly.

| Size        | Use when           | Contents                                                                     |
| ----------- | ------------------ | ---------------------------------------------------------------------------- |
| Lightweight | Small subsystem    | Sections 1, 2, 4 only. Skip Data Model if types are self-documenting.        |
| Medium      | Moderate subsystem | All sections, with concrete types and interfaces.                            |
| Heavyweight | Large domain       | All sections plus Security, Failure Modes, Migration, Performance as needed. |

### Spec status values

- **Draft** — initial write-up, may not reflect code accurately yet
- **Implemented** — spec matches the code
- **Partial** — some sections are implemented, others remain planned
- **Deprecated** — system is being replaced or removed

### The spec lifecycle

```
Planned → In Progress → Implemented
```

- **Planned**: Spec written before code. Maximum detail in Architecture, Data Model, Interfaces, and Implementation Phases. This is the blueprint the agent builds from.
- **In Progress**: Code is being written. The spec remains the source of intent while code becomes the source of implementation detail.
- **Implemented**: Code exists and works. The spec should emphasize why, boundaries, and non-obvious decisions more than implementation mechanics.

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
- **Full implementations** — Code belongs in code files. Specs can show key signatures, schemas, and API shapes, but not complete implementations.
- **Explaining standard concepts** — Don't teach the agent what git, HTTP, or encryption is. Document your specific application of these concepts.

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

Every non-obvious choice gets its own entry with explicit rationale. This is what agents need most when modifying existing code — understanding why something is the way it is prevents accidental design regression.

Format:

```markdown
- **Decision:** Discovery uses `DefaultPackageManager.resolve(...)` instead of manual parsing.
  - **Rationale:** It exactly matches the real extension/package discovery rules, including package manifests, precedence, and path filters.
```

Good decisions to document:

- Why one approach was chosen over alternatives
- Why a dependency was or wasn't used
- Why a particular scope or boundary was drawn
- Security or performance tradeoffs
- Caching, injection, or lifecycle strategies

### When to include concrete artifacts

Include copy-pasteable artifacts when they carry design intent an agent couldn't derive from context:

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

- action: read the code thoroughly first (see READ_CODE procedure), then write a living spec
- always → REGISTER_IN_INDEX

### REVIEW_SPEC

- action: evaluate the spec against the quality checklist in Validation
- guard: spec needs changes → apply fixes, then → REGISTER_IN_INDEX
- guard: spec is good → DONE

### REGISTER_IN_INDEX

- action: ensure SPECS_README has an entry for this spec with Purpose and Code columns
- always → DONE

### DONE

- terminal state

## Procedures

### READ_CODE

This is the foundation for any spec based on existing code. Read the actual implementation thoroughly:

- Entry points and public interfaces
- Data model / types / schemas
- Key flows and state transitions
- Integration boundaries (what talks to what)
- Error handling patterns
- Test coverage (what's tested tells you what matters)

Never write a spec from memory or assumptions. The code is the source of truth for what exists. The spec adds why it exists and what its boundaries are.

### WRITE_PLANNING_SPEC

Write all sections at full detail. This is the blueprint an agent will implement from.

1. Create file in SPECS_DIR with kebab-case name matching the stable domain
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

Place this early so the agent internalizes constraints before reading architecture details.

#### Section 3: Architecture

```markdown
## 3. Architecture

### Component structure

File tree or module map showing what will be created.

### Data flow

ASCII diagram or numbered flow showing how data moves through the system.
```

Include concrete file paths, crate names, or module structure. The agent needs to know where things belong.

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

Transition a spec from Planned/In Progress to Implemented. The goal is to keep what code can't express and remove what it already expresses.

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

1. Read the actual implementation thoroughly using the READ_CODE procedure
2. Identify the non-obvious decisions — anything where the code's what doesn't explain the why
3. Write the spec following the living-spec density (see Knowledge table)
4. Prioritize Design Decisions — interview the user if rationale isn't clear from code

### Updating SPECS_README

The index groups specs by system area with `##` headings. Each area has a 3-column table:

```markdown
# Specifications

Persistent domain specifications. Organized by system area, not feature chronology.

## [Category Name]

| Spec                     | Purpose          | Code                                |
| ------------------------ | ---------------- | ----------------------------------- |
| [domain.md](./domain.md) | One-line purpose | `src/domain/`                       |
| [other.md](./other.md)   | One-line purpose | `src/other/`, `src/shared/utils.ts` |

## [Another Category]

| Spec | Purpose | Code |
| ---- | ------- | ---- |
| ...  | ...     | ...  |
```

Index rules:

- Group by system area, not alphabetically
- Code column can list multiple paths
- Update every time a spec is created, renamed, or its code location changes
- If a spec is deprecated, move to a "Deprecated" section rather than deleting

## Constraints

- Specs describe intent, code describes reality. When they conflict, the code is correct and the spec needs updating.
- Specs are organized by stable domain, never by feature or chronology.
- Always read the code before writing — never spec from imagination.
- Never transcribe entire type definitions or function bodies into specs.
- Design Decisions must have rationale. A decision without a "why" is useless — the agent can read what from the code.
- Non-Goals are mandatory. Unbounded specs lead to unbounded implementations.
- Don't over-spec small things — a 10-line utility doesn't need a spec.
- Keep specs under 400 lines for simple systems, under 800 for complex ones. Exception: planning specs for large multi-component systems may legitimately need more.
- One spec per system area. Don't split a single system across multiple specs. Don't combine unrelated systems into one spec.
- Always update the index. A spec not in SPECS_README effectively doesn't exist for discovery.

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
- [ ] Domain name follows stable naming conventions, not feature/chronology-based

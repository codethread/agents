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

Specs are not implementation plans. File paths, file trees, implementation phases, and migration steps belong in an ephemeral technical plan (see PLAN_SKILL), which is deleted once the work ships. A spec references code at module level at most.

## Variables

| Variable     | Value             | Notes                                              |
| ------------ | ----------------- | -------------------------------------------------- |
| SPECS_DIR    | `specs/`          | Root directory for all spec files                  |
| SPECS_README | `specs/README.md` | Index table linking specs to modules               |
| PLAN_SKILL   | `plan-authoring`  | Companion skill for ephemeral implementation plans |

## Prerequisites

- The feature or system being specified has a clear scope
- If updating an existing spec, read the current spec and its referenced modules first
- Read the actual code before writing or updating a spec

## Knowledge

### Code-first principle

Specs describe intent informed by reality. Code is the source of truth for what exists; specs capture why it exists, what boundary it belongs to, and what should not change accidentally. Never write a spec from memory or assumption — read the code first.

### The three-document split

Each kind of knowledge has exactly one home. Duplication across homes is the failure mode this split prevents.

| Document       | Owns                                                      | Lifetime                           |
| -------------- | --------------------------------------------------------- | ---------------------------------- |
| Spec           | Why, boundaries, rejected alternatives, domain contracts  | Permanent, evolves with the domain |
| Technical plan | How and where: file paths, phases, migrations, sequencing | Deleted when the change ships      |
| Code + tests   | What exists and how it behaves                            | The ground truth                   |

A spec that lists file paths is doing the plan's job; a plan that explains rationale is doing the spec's job. When work completes, the plan dies: its durable decisions are harvested into the spec, and its mechanics are delegated to the code and test suite.

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

### Module-level code references

A spec references code at module/package granularity, never per-file. The reader who needs file-level detail should open the module's README or the code itself — file lists in a spec go stale silently and waste the reader's attention.

| Reference                                                      | Allowed in spec?  |
| -------------------------------------------------------------- | ----------------- |
| `packages/pithos` (module root)                                | Yes               |
| "the engine module" (named concept the module README maps)     | Yes               |
| `packages/pithos/src/engine.ts` (individual file)              | No                |
| Per-file tables ("Code Locations", "Testing" file inventories) | No                |
| Test directory pointer (`packages/pithos/test/`)               | Yes, one line max |

The SPECS_README index Code column is the authoritative spec→module mapping; the spec body needs at most one sentence naming where the system lives.

### Spec sizing

Choose the lightest spec shape that still captures the boundary clearly. **Default to minimal.** A spec competes with the code and tests for a reader's attention; detail that duplicates them is a liability, not a feature.

Size by module LOC (source lines, excluding tests):

| Module LOC | Default shape | Contents                                                                                                                         |
| ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| < 2000     | Minimal       | Overview (Purpose, Goals, Non-Goals) and Design Decisions only. No concept/interface prose — the source is short enough to read. |
| 2000–5000  | Medium        | Add Domain Concepts and contract-bearing Interfaces. Still no type transcriptions or behavioral prose that tests already encode. |
| > 5000     | Heavyweight   | All sections as needed. Even then, prefer pointers over restatement.                                                             |

Tests count as documentation. If a well-named test file covers a behavior, the spec should not restate it in prose.

The threshold is a guide, not a hard rule. A 500-LOC module with a subtle cross-system contract may still need a medium spec; a 3000-LOC module that's mostly boilerplate may still only need a minimal one. Err minimal and grow when readers actually struggle.

### Spec status values

- **Draft** — initial write-up, may not reflect code accurately yet
- **Planned** — describes intended contracts for a system not yet built
- **Implemented** — spec matches the code
- **Partial** — some sections are implemented, others remain planned
- **Deprecated** — system is being replaced or removed

A Planned spec has the same shape and density as an Implemented one — it states intended contracts and rationale, not build instructions. The build instructions live in a technical plan (PLAN_SKILL). When the code ships, only the status changes; there is no "slim down" pass because the implementation detail was never in the spec.

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

### What specs are NOT for

- **File-level code maps** — No file trees, no "Code Locations" tables, no test-file inventories. Module-level references only.
- **Implementation sequencing** — Phases, task checklists, and time estimates belong in a technical plan (PLAN_SKILL).
- **Restating type definitions** — If a TypeScript interface or Rust struct is self-documenting, don't transcribe it into the spec.
- **Listing test assertions in prose** — Well-named `describe`/`it` blocks communicate this better than spec bullet points.
- **Full implementations** — Code belongs in code files. Specs can show key signatures, schemas, and API shapes, but not complete implementations.
- **Explaining standard concepts** — Don't teach the agent what git, HTTP, or encryption is. Document your specific application of these concepts.

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

Include copy-pasteable artifacts when they carry contract-level design intent an agent couldn't derive from context:

| Artifact                | Include in spec?                                 |
| ----------------------- | ------------------------------------------------ |
| SQL schema DDL          | Yes — defines the data contract                  |
| API endpoint tables     | Yes — defines the interface contract             |
| CLI flag definitions    | Yes — defines the user contract                  |
| Config env vars table   | Yes — operational contract                       |
| External API details    | Yes — domain knowledge agents lack               |
| Rust/TS type signatures | Only key contract types; the code holds the rest |
| Full function bodies    | No — code is the truth                           |
| File trees / file maps  | No — technical plan territory                    |

## Decisions

Entry state: DETERMINE_MODE

### DETERMINE_MODE

- guard: user wants a new spec (built or unbuilt system) → WRITE_SPEC
- guard: user wants to update a spec after code changes → UPDATE_SPEC
- guard: user wants to review/improve an existing spec → REVIEW_SPEC
- guard: user wants implementation detail — file paths, phases, sequencing, migration steps → redirect to PLAN_SKILL. If durable contract decisions surface during that planning, return here to record them.

### WRITE_SPEC

- action: write the spec per Procedures (READ_CODE first when code exists; status Planned when it doesn't)
- guard: user also needs implementation planning → note that PLAN_SKILL handles it; do not add plan content to the spec
- always → REGISTER_IN_INDEX

### UPDATE_SPEC

- action: read current spec and code, update contracts and status per Procedures
- guard: spec contains file paths, file trees, phases, or test inventories → strip them (move to an active technical plan if work is in flight, otherwise delete)
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

### WRITE_SPEC

1. Create file in SPECS_DIR with kebab-case name matching the stable domain
2. Add frontmatter: `**Status:** <Planned|Implemented>`, `**Last Updated:** <date>`
3. **Measure the module's source LOC** (existing code) or estimate scope (planned). If minimal-sized, write only Overview and Design Decisions — stop there.
4. Write sections in this order, including only those the sizing tier calls for:

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

Place this early so the agent internalizes constraints before reading domain details.

#### Section 3: Domain Concepts

The heart of a medium/heavyweight spec: the named concepts, invariants, and behavioral contracts of the domain, written in domain vocabulary. Tables for enumerable rules (edge kinds, states, status values), short prose for invariants, ASCII diagrams only when they show cross-component flow.

This section describes the domain, not the code structure. "Gate edges are excluded from branch membership" belongs here; "branch closure is computed in `chain-policy.ts`" does not.

#### Section 4: Data Model (if contract-bearing)

```markdown
## 4. Data Model

### Database schema (if applicable)

Full SQL DDL — this is a design contract, not documentation.

### Core types

Key contract type signatures only; skip internal helpers. The code holds full definitions.
```

#### Section 5: Interfaces (if contract-bearing)

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

#### Section 6: Open Questions

```markdown
## 6. Open Questions

- Should X support Y? (tradeoff: complexity vs flexibility)
- Is Z the right default? (alternative: W)
```

5. If the system's home module isn't obvious from the index entry alone, add at most one sentence in the Overview naming it (e.g. "Lives in `packages/pithos`; behavior is covered by its test suite."). No file lists.

### UPDATE_SPEC

Keep the spec true to the code after changes, or transition Planned → Implemented when work ships.

1. Read the changed code (READ_CODE) and the current spec
2. Update contracts that changed: Domain Concepts, Data Model, Interfaces
3. Record any new durable decisions in Design Decisions — including ones harvested from a retiring technical plan
4. Resolve or update Open Questions
5. Update `**Status:**` and `**Last Updated:**`
6. Strip any implementation detail that crept in: file paths, file trees, phase checklists, test-file inventories. If the detail is still needed (work in flight), it belongs in the technical plan, not here.

### Updating SPECS_README

The index groups specs by system area with `##` headings. Each area has a 3-column table:

```markdown
# Specifications

Persistent domain specifications. Organized by system area, not feature chronology.

## [Category Name]

| Spec                     | Purpose          | Code              |
| ------------------------ | ---------------- | ----------------- |
| [domain.md](./domain.md) | One-line purpose | `packages/domain` |
| [other.md](./other.md)   | One-line purpose | `packages/other`  |

## [Another Category]

| Spec | Purpose | Code |
| ---- | ------- | ---- |
| ...  | ...     | ...  |
```

Index rules:

- Group by system area, not alphabetically
- Code column lists module/package roots only — never individual files or `src/` subpaths
- Update every time a spec is created, renamed, or its module mapping changes
- If a spec is deprecated, move to a "Deprecated" section rather than deleting

## Constraints

- Specs describe intent, code describes reality. When they conflict, the code is correct and the spec needs updating.
- Specs are organized by stable domain, never by feature or chronology.
- Always read the code before writing — never spec from imagination.
- Never list individual file paths in a spec. Module/package roots at most, one pointer, not a table.
- Implementation phases, file trees, code-location tables, and migration sequences belong in a technical plan (PLAN_SKILL), never in a spec.
- Never transcribe entire type definitions or function bodies into specs.
- Design Decisions must have rationale. A decision without a "why" is useless — the agent can read what from the code.
- Non-Goals are mandatory. Unbounded specs lead to unbounded implementations.
- Don't over-spec small things — a 10-line utility doesn't need a spec.
- **Size threshold:** for modules under ~2000 source LOC, default to a minimal spec (Overview + Design Decisions only). The source is short enough to read directly; tests cover behavior. Grow the spec only when readers demonstrably can't navigate the code without it.
- Tests are documentation. Don't restate in prose what a well-named test file already asserts, and don't inventory test files — a one-line test directory pointer at most.
- Keep specs under 400 lines for simple systems, under 800 for complex ones.
- A spec approaching the LOC of its module is a smell — either the spec is restating code or the module is under-factored.
- One spec per stable domain/system boundary. Don't split a single system across multiple specs. Don't combine unrelated systems into one spec. ("System area" is an index grouping, not the unit of a spec — an area may hold several domain specs.)
- Always update the index. A spec not in SPECS_README effectively doesn't exist for discovery.

## Validation

Before considering a spec complete, verify:

- [ ] Status and Last Updated are set correctly
- [ ] Overview has Purpose, Goals, and Non-Goals
- [ ] Design Decisions section exists with at least one decision + rationale
- [ ] No individual file paths appear anywhere in the spec — module/package roots only, at most one pointer
- [ ] No implementation phases, file trees, code-location tables, or test-file inventories (these belong in a technical plan)
- [ ] No full function implementations appear in the spec
- [ ] No type definitions are transcribed verbatim when the code holds them
- [ ] SPECS_README index includes an entry with a module-root Code column
- [ ] Spec line count is proportionate to system complexity (not a 1:1 mirror of code)
- [ ] For modules under ~2000 LOC, spec is minimal (Overview + Design Decisions) unless a specific reader-facing gap justifies more
- [ ] No prose restates behavior that a well-named test file already covers
- [ ] Domain name follows stable naming conventions, not feature/chronology-based

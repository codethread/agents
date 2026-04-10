---
name: skill-authoring
description: >
  Guide for authoring well-structured agent skills using a knowledge/procedures/decisions
  taxonomy. Use when users want to create a new skill, improve an existing skill's structure,
  or convert a workflow into a skill. Triggers on phrases like "create a skill", "write a skill",
  "turn this into a skill", "structure this skill", "improve this skill", or any request to
  encode a workflow, runbook, or process as a reusable SKILL.md. Also use when a user asks
  how to organise skill content, or wants to add state-machine logic to an existing skill.
---

# Skill Authoring Guide

This skill teaches you how to write effective SKILL.md files using a structured taxonomy. Every skill encodes some combination of six concerns. Recognising which concerns are present — and separating them cleanly — is what makes a skill reliable and maintainable.

## The Six Concerns

| Concern       | What it answers                                     | Required?     |
| ------------- | --------------------------------------------------- | ------------- |
| Variables     | What external names/refs does this skill depend on? | Recommended   |
| Prerequisites | What must be true before execution?                 | If applicable |
| Knowledge     | What facts/conventions does the agent need?         | Usually       |
| Procedures    | What steps does the agent follow?                   | Usually       |
| Decisions     | What branching/state logic governs the flow?        | If applicable |
| Constraints   | What must the agent never do?                       | Recommended   |
| Validation    | How does the agent know it succeeded?               | Recommended   |

Not every skill needs all six. A pure knowledge skill (e.g. "how our API auth works") may only have Variables, Knowledge, and Constraints. A workflow skill will have most or all.

The rest of this guide explains each concern, its position in the document, and how to write it well.

---

## Document Order

Skills should follow this order. The rationale: the agent reads top-to-bottom, so it needs context (variables, prerequisites) before instructions (procedures, decisions), and boundaries (constraints, validation) bookending the whole thing.

```
1. Variables          ← names, refs, config that may change
2. Prerequisites      ← what to check/verify before starting
3. Knowledge          ← facts, conventions, reference material
4. Decisions          ← state machine / branching logic (the map)
5. Procedures         ← step-by-step actions (the directions)
6. Constraints        ← boundaries, invariants, never-do rules
7. Validation         ← success criteria, verification steps
```

Note: Decisions comes before Procedures. The agent should see the full map of possible states before reading the detailed steps for each state. This prevents the model from charging down a happy path and losing track of branches.

---

## 1. Variables

A lookup table of external references. Anything that could change independently of the skill's logic — agent names, tool names, repo paths, branch conventions, complementary skills — goes here. This avoids scattering references through prose where they fall out of sync.

### Format

Use a simple key-value table. Keys should be UPPER_SNAKE_CASE so they stand out when referenced later in the document.

### Good example

```markdown
## Variables

| Variable      | Value                                  | Notes                          |
| ------------- | -------------------------------------- | ------------------------------ |
| PRIMARY_AGENT | scout                                  | The exploration/research agent |
| REVIEW_AGENT  | sentinel                               | The code review agent          |
| RELEASE_SKILL | npm-release                            | Complementary release workflow |
| MAIN_BRANCH   | main                                   | Protected branch               |
| REGISTRY      | https://registry.npmjs.org             | Publish target                 |
| COMMIT_TYPES  | feat, fix, chore, docs, refactor, test | Allowed semantic prefixes      |
```

Then later in the document, refer to these by name:

```markdown
### From DIRTY_WORKTREE

1. Classify changes using COMMIT_TYPES
2. Push to MAIN_BRANCH
3. Hand off to REVIEW_AGENT for verification
```

### Bad example

```markdown
Push to the main branch (we call it "main" but some repos use "master")
and then the sentinel agent will review it, or if you renamed it, whatever
the review agent is called now.
```

This buries references in prose. When the user renames "sentinel" to "guardian", they have to find-and-replace through the entire skill and hope they caught everything.

### When to skip

Very simple skills with no external references. If the skill is self-contained (e.g. "how to write a good commit message"), you probably don't need this section.

---

## 2. Prerequisites

Minimal checks the agent must perform before starting. These are conditions, not steps. Keep this section short — if it's longer than 5-6 lines, some of it probably belongs in Procedures or Knowledge.

### Good example

```markdown
## Prerequisites

- Working directory is a git repository
- `npm` is available on PATH
- User has publish permissions to REGISTRY
- No merge conflicts in current branch
```

### Bad example

```markdown
## Prerequisites

- First, check if git is installed by running `git --version` and parsing the output
  to ensure it's at least version 2.x. If it's not, suggest the user install...
- Then verify npm by running `npm --version` and check that...
```

This is procedures disguised as prerequisites. Prerequisites state _what must be true_, not _how to check it_. The agent can figure out how to verify "npm is available on PATH".

---

## 3. Knowledge

Facts, conventions, reference material, and domain context the agent needs but wouldn't know from training. This is _declarative_ — it tells the agent what things are, not what to do with them.

### When to use

- API conventions the model wouldn't know (your internal API style, your commit format)
- Domain-specific terminology or rules
- Reference tables (status codes, allowed values, naming patterns)
- Links to external docs the agent should `cat` for detail

### Good example

```markdown
## Knowledge

### Commit message format

We use Conventional Commits: `type(scope): description`

- type: one of COMMIT_TYPES
- scope: the package or area affected (optional for single-package repos)
- description: imperative mood, lowercase, no period

### Version strategy

We follow semver. The relationship between commit types and version bumps:

| Commit type                     | Version bump |
| ------------------------------- | ------------ |
| fix                             | patch        |
| feat                            | minor        |
| any with BREAKING CHANGE footer | major        |

### Package structure

For detailed package layout, read `references/package-structure.md`.
```

### Bad example

```markdown
## Knowledge

Conventional Commits is a specification for commit messages. You can read about it
at conventionalcommits.org. It was created in 2017 and has gained wide adoption...
```

Don't teach the model things it already knows. Focus on _your_ specific application of general concepts. The model knows what Conventional Commits is; it doesn't know which types your team allows or how you map them to version bumps.

---

## 4. Decisions

The state machine. This section provides the _map_ of all possible states and transitions before the agent reads any detailed procedures. Use XState-inspired prose — named states, explicit guards, and unambiguous transitions.

### When to use

- The workflow has branching paths (not just a linear sequence)
- Different conditions lead to different actions
- There are error states or recovery paths
- The workflow can loop back to earlier stages

If your skill is purely linear (do A, then B, then C), skip this section and just use Procedures.

### Format: XState-inspired prose

Borrow XState's _concepts_ (states, guards, transitions) but write them in markdown the model can follow as instructions. Do not use actual XState JSON or mermaid — these are data formats, not instruction formats.

#### Structure

```markdown
## Decisions

Entry state: CHECK_WORKTREE

### CHECK_WORKTREE

- guard: `git status --porcelain` is empty
  → BUMP_VERSION
- guard: has unstaged changes
  → SEMANTIC_COMMIT
- guard: has merge conflicts
  → STOP with error: "Resolve merge conflicts before releasing"

### SEMANTIC_COMMIT

- action: create a semantic commit (see Procedures)
- always → CHECK_WORKTREE

### BUMP_VERSION

- action: bump version based on commits since last tag (see Procedures)
- guard: bump succeeded
  → BUILD
- guard: bump failed
  → STOP with error

### BUILD

- action: run build (see Procedures)
- guard: build passes
  → PUBLISH
- guard: build fails
  → REVERT_VERSION

### PUBLISH

- action: publish to REGISTRY (see Procedures)
- guard: publish succeeded
  → DONE
- guard: publish failed
  → REVERT_VERSION

### REVERT_VERSION

- action: revert the version bump commit
- always → STOP with error: "Release failed. Version bump reverted."

### DONE

- terminal state, release complete
```

### Good patterns

- **Every state has explicit exit paths.** No state should leave the agent guessing what to do next.
- **Guards are observable conditions**, not vibes. "build passes" = exit code 0. "has unstaged changes" = `git status --porcelain` produces output.
- **Cross-reference Procedures by name.** The decision map says _what_ to do and _when_; the procedures section says _how_.
- **Error states are explicit.** Don't assume the happy path. Name the failure modes.
- **Entry state is declared.** The agent knows where to start.

### Bad example

```markdown
## Workflow

First check if the worktree is clean. If not, you should probably commit. Then bump the version. If that works, try building. If the build fails, you might want to revert. Then publish.
```

Problems: no named states, ambiguous transitions ("you should probably"), no explicit error handling, no entry point, "might want to" gives the model permission to skip critical steps.

### When the state machine is reused

If multiple skills share the same decision logic (e.g. a release state machine used by both npm-release and pypi-release), extract it to `references/release-states.md` and have each skill reference it. But for single-skill use, keep it inline.

---

## 5. Procedures

Step-by-step instructions for each action referenced in the Decisions section. If there's no Decisions section, this is the main body of the skill.

### Format

Organise procedures under the state they belong to. Each procedure is a numbered list of imperative steps.

### Good example

```markdown
## Procedures

### SEMANTIC_COMMIT

1. Run `git diff --name-only` to list changed files
2. Group changes by area/scope
3. For each group:
   a. Stage files: `git add <files>`
   b. Determine the appropriate type from COMMIT_TYPES based on the nature of changes
   c. Commit: `git commit -m "type(scope): description"`
4. Verify all changes are committed: `git status --porcelain` should be empty

### BUMP_VERSION

1. Collect commits since last git tag: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
2. Determine the highest-priority bump using the version strategy in Knowledge
3. Run `npm version <patch|minor|major> --no-git-tag-version`
4. Commit the version bump: `git commit -am "chore(release): vX.Y.Z"`
5. Tag: `git tag vX.Y.Z`
```

### Bad example

```markdown
## Steps

1. Check worktree
2. Maybe commit
3. Bump version
4. Build
5. If build fails, revert
6. Publish
7. If publish fails, also revert
```

Problems: mixes decisions and procedures, steps are vague ("maybe commit"), no actual commands, conditional logic buried in a linear list.

### For linear skills (no Decisions section)

Just write numbered steps directly:

```markdown
## Procedures

1. Read the input CSV from the provided path
2. Validate headers match expected schema (see Knowledge)
3. Transform date columns to ISO 8601
4. Write output to `output/cleaned.csv`
```

---

## 6. Constraints

Things the agent must never do, always do, or invariants that must hold throughout execution. These are not steps — they're boundaries.

### Good example

```markdown
## Constraints

- Never force-push to MAIN_BRANCH
- Never publish with uncommitted changes in the worktree
- Always run the build before publishing — never publish from source directly
- Version tags must match the format `vX.Y.Z` (no prefix variations like `version-X.Y.Z`)
- If any step fails, never continue to the next state — follow the error transition
```

### Bad example

```markdown
## Important notes

- Try to avoid force-pushing if possible
- It's generally a good idea to build before publishing
```

"Try to" and "generally" give the model wiggle room to ignore constraints. Constraints should be absolute. If something is merely preferred, put it in Knowledge as a convention.

---

## 7. Validation

How the agent confirms the skill executed successfully. This is the last thing the agent does — a checklist of observable conditions that prove success.

### Good example

```markdown
## Validation

Verify all of the following before reporting success:

- [ ] `git status --porcelain` is empty (no uncommitted changes)
- [ ] `git tag --list` includes the new version tag
- [ ] `npm view <package-name> version` returns the new version
- [ ] Build artefacts exist in `dist/`
- [ ] No errors in the publish output
```

### Bad example

```markdown
## Done

You're done! Let the user know everything went well.
```

No verification, no observable conditions. The agent might report success even if the publish silently failed.

---

## Putting It All Together

Here is a minimal but complete example of a well-structured skill:

```markdown
---
name: npm-release
description: >
  Handles the full npm package release workflow: committing uncommitted changes
  with semantic commits, version bumping, building, and publishing to npm.
  Use when the user says "release", "publish to npm", "bump version and publish",
  or "do a release". Also use when the user asks to publish a package or push a
  new version.
---

# npm-release

## Variables

| Variable     | Value                                  | Notes                      |
| ------------ | -------------------------------------- | -------------------------- |
| MAIN_BRANCH  | main                                   | Protected branch           |
| REGISTRY     | https://registry.npmjs.org             | Publish target             |
| COMMIT_TYPES | feat, fix, chore, docs, refactor, test | Semantic prefixes          |
| BUILD_CMD    | npm run build                          | Project build command      |
| REVIEW_AGENT | sentinel                               | Hands off for verification |

## Prerequisites

- Working directory is a git repository with a `package.json`
- `npm` is available on PATH
- User has publish permissions to REGISTRY
- Current branch is MAIN_BRANCH

## Knowledge

### Commit format

Conventional Commits: `type(scope): description`

- type: one of COMMIT_TYPES
- scope: package or area (optional for monorepos)
- description: imperative, lowercase, no trailing period

### Version mapping

| Commit type                     | Bump  |
| ------------------------------- | ----- |
| fix                             | patch |
| feat                            | minor |
| any with BREAKING CHANGE footer | major |

## Decisions

Entry state: CHECK_WORKTREE

### CHECK_WORKTREE

- guard: `git status --porcelain` is empty → BUMP_VERSION
- guard: unstaged or uncommitted changes exist → SEMANTIC_COMMIT
- guard: merge conflicts present → STOP with error

### SEMANTIC_COMMIT

- action: create semantic commit(s) per Procedures
- always → CHECK_WORKTREE

### BUMP_VERSION

- action: determine and apply version bump per Procedures
- guard: succeeded → BUILD
- guard: failed → STOP with error

### BUILD

- action: run BUILD_CMD
- guard: exit code 0 → PUBLISH
- guard: non-zero exit → REVERT_VERSION

### PUBLISH

- action: publish to REGISTRY per Procedures
- guard: succeeded → DONE
- guard: failed → REVERT_VERSION

### REVERT_VERSION

- action: `git reset --hard HEAD~1` and delete tag if created
- always → STOP with error: "Release failed, version bump reverted"

### DONE

- terminal state

## Procedures

### SEMANTIC_COMMIT

1. `git diff --name-only` to list changed files
2. Group by area/scope
3. For each group:
   a. `git add <files>`
   b. Choose type from COMMIT_TYPES
   c. `git commit -m "type(scope): description"`
4. Confirm: `git status --porcelain` is empty

### BUMP_VERSION

1. `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
2. Determine bump level using version mapping
3. `npm version <level> --no-git-tag-version`
4. `git commit -am "chore(release): vX.Y.Z"`
5. `git tag vX.Y.Z`

### PUBLISH

1. `npm publish --registry REGISTRY`
2. `git push origin MAIN_BRANCH --tags`

## Constraints

- Never force-push to MAIN_BRANCH
- Never publish with uncommitted changes
- Never skip BUILD — always build before publish
- If any state transitions to STOP, do not continue
- Tags must match `vX.Y.Z` exactly

## Validation

- [ ] `git status --porcelain` is empty
- [ ] `git tag -l` includes new version
- [ ] `npm view <package> version` matches new version
- [ ] `dist/` directory contains build output
- [ ] `git log -1` shows the version bump commit
```

---

## Common Mistakes

### Mixing decisions into procedures

If you find yourself writing "if X then do Y, otherwise do Z" inside a numbered list, extract it into the Decisions section as a named state with guards.

### Omitting error paths

Every guard in Decisions should account for failure. If bumping the version can fail, there must be a transition for that. The model will improvise if you leave gaps — and improvisation is exactly what skills are meant to prevent.

### Variables that aren't variable

Don't put things in Variables that are intrinsic to the skill and would never change (e.g. `GIT_COMMAND = git`). Variables are for things the _user_ might customise.

### Knowledge the model already has

Don't explain what git is, what npm does, or how semver works. Focus on _your_ specific conventions and choices. The model's training covers general knowledge; your skill covers what's specific to your team/project.

### Prose-heavy procedures

Procedures should read like a recipe, not an essay. If a step takes more than two lines, it's either multiple steps or it belongs in Knowledge as context.

### Missing validation

Without validation, the agent reports "done" based on vibes. Always include observable conditions that prove success.

# Millstrand → Hive migration, 2026-10-22–23

## Scope and result

The capture contains **18 feature cards and 37 tasks**, **37 parent links**, and **7 internal blocking links**. Records comprise 48 closed, six open, and one blocked human-review feature (`agents-ms-z0jyc`). All 46 nonempty bodies are verbatim. No comments, sessions, claims, or live workflow execution were imported.

Deterministic input and source evidence are in [`millstrand-2026-10-22/`](millstrand-2026-10-22/). `report.json` maps workspace-qualified source references to Bead IDs. The [migration skill](../../.agents/skills/millstrand-to-beads/SKILL.md) documents the reusable procedure and converter.

The real tracker contains all **55 imported records and 44 relationships**; an independent managed Bee audit found zero mismatches. Repeat exact-ID reconciliation reported **55 equal, zero creates, zero updates, zero conflicts**, matching the rehearsal. The user authorized recovery on October 23; a fresh source capture was unchanged. Native three-way merge certified the canonical export without force flags, conflicts, or deletes.

The local tracker contract is committed as `b8647a7`; imported work and completed smoke evidence are committed on `tracker/state` as `a4c320e`. Neither application nor tracker history has been pushed.

The source board and running mill remain untouched. `.millstrand/` and package-owned identity behavior remain. Track new work in Hive, not both schedulers.

## Mapping decisions

- IDs become `agents-ms-<strand>`; `external_ref` retains `millstrand:agents:<strand>`.
- Bodies remain byte-for-byte descriptions. Selected decision/blocker/handoff attributes become historical notes; the archive retains full raw attributes.
- Parent edges reverse direction into native child → parent dependencies. Blocking edges retain task → prerequisite direction.
- Numeric priorities preserve p1…p4; tasks inherit their nearest explicit ancestor priority.
- Lifecycle state overrides stale lanes. In-review stays blocked for human action; no human assignee is invented. Legacy active claims reopen unassigned, not as live Bee workers.
- Closed outcomes distinguish abandoned from unactioned. Last update is the disclosed proxy for closure time.
- Review cross-card/external prerequisites and comment-only decisions separately. This migrates work context, not a complete Millstrand backup.

## Automation

`.hive/bees.toml` contains **19 effective kinds**: nine available aliases, three reviewer lenses, and seven Pi roles. Alias inheritance was flattened without changing models or efforts. Disabled Claude/Cursor aliases (`fable`, `opus`, `grok`) remain disabled. [Catalog details](../bees/README.md) describe fallback, provider-condition, and reviewer-selector gaps.

The installed `do-work` workflow handles bounded assignments, not Millstrand's automatic review/landing state machines. Live executions and historical associations were not replayed. Workflow dependencies install through the existing pnpm workspace and lockfile.

## Live Colony verification

The repository has a **durable, awake** registration on the existing shared daemon. Only this repository was activated; other colonies and the mill were not stopped or reconfigured. Limits remain four colony-wide, two per kind, and two per worktree.

| Bee                      | Request      | Workflow     | Authored response | Result                   |
| ------------------------ | ------------ | ------------ | ----------------- | ------------------------ |
| `grunt` / DeepSeek Flash | `agents-jnq` | `agents-8az` | `agents-qpb`      | succeeded; workflow done |
| `scout` / GPT-6 Luna     | `agents-z8y` | `agents-zwc` | `agents-j2m`      | succeeded; workflow done |

Both ran their configured native Pi formulas. Each response confirmed a distinct Scent identity, the selected repository database, and receipt of a Beeswax safety rule. Grunt compared every imported record and dependency through native `br` reads; Scout returned verified converter/test locations. Neither changed application files or historical tasks. Independent `colony explain` observations show terminal/completed checkpoints, stopped owned processes, and empty occupied capacity—not merely quiet stdout.

A third managed Bee (`prose`, request `agents-sry`, workflow `agents-4t3`) edited the three handoff documents within its assigned scope. Its authored response `agents-fc2` records the editorial checks; the workflow reached done and its process and capacity were also released. [Runtime receipts](millstrand-2026-10-22/smoke-results.json) and the [verification ledger](millstrand-2026-10-22/verification.json) retain the evidence.

BV was queried against the selected SQLite database with `--recipe _hive_work --robot-triage`, `--robot-plan`, and `--robot-insights`. Its work view excludes system/workflow records while retaining imported work and authored reports. The inherited backlog is **six open records and one blocked human-review feature**, with no dependency cycles. BV graph edges count the seven blocking edges, not the 37 verified hierarchy links; use native `br dep` for parent ancestry. No historical task was claimed or closed during the smoke.

The `_hive_workflows` view shows all six run/stage records closed. `_hive_system` retains three closed requests and three open `busybee-checkpoint` records; those are saved workflow state, not live workers. The native `bee-attention` query is empty.

## Hive-stack issue candidates

Observations for upstream triage, not filed issues. Installed tools: Beeswax/Scent 0.9.1 and native `br` 0.7.6 (the version alone does not identify its patch set).

### 1. First initialization misses the just-committed contract

**Reproduction:** Generate the contract with `beeswax setup --tracker none`, commit it locally, then run `beeswax setup --tracker init`. The new tracker checkout started at `18049dd` (the prior `origin/main`) rather than local setup commit `b91c10a`. Setup created the database, then failed with `cause: migration_required` because the tracker contained the old pre-commit and no pre-merge hook.

**Workaround used:** Inspect partial effects; copy only the approved hook pair, config/lock, merge attributes, and recipes into the newly created tracker; rerun setup with `--tracker adopt` and its exact database. No data was discarded and initialization was not repeated.

**Suggested improvement:** Initialize from the prepared canonical contract or preflight the actual tracker base before creating a database. Return the conflicting checkout/path, not only a generic hook-migration handoff.

### 2. Existing hooks require a manual insertion even for a simple chain

The first setup attempt stopped after configuration/binding/merge-driver phases because pre-commit already ran lint-staged, typecheck, and changed tests. The installed hook-migration guidance was sufficient, but obtaining the exact generated section required a disposable repository.

**Workaround:** Insert the generated validation section before application checks and use `beeswax system hooks is-tracker-snapshot` to skip those checks only for snapshot-only commits. Preserve Husky and all application checks.

**Suggested improvement:** Offer a previewable hook-section command and an explicit append/prepend choice with snapshot-only handling explained alongside it.

### 3. No alias inheritance, fallback, or availability equivalent

Colony requires fully resolved kind model/effort/harness fields. Millstrand's `grunt → deepseek or luna`, runtime `seat/allow-china`, disabled harnesses, and reviewer glob/label selection do not map directly.

**Workaround:** Capture the selected available candidate, preserve `allow` discovery lists, leave disabled aliases unconfigured, and document manual policy changes. Do not imply discovery visibility is execution authorization.

**Suggested improvement:** Document this mapping or provide an export/flatten utility; identify unsupported policies before activation.

### 4. Native exact-ID import is safe but not a smooth importer interface

`br` has no `import` subcommand. Reviewed `sync --reconcile-additive` supplied the needed lossless, exact-ID operation and hash-bound plan. However:

- An empty optional `description` string fails storage round-trip validation; absent bodies must omit the field.
- A normal `br list` between plan and apply invalidated the token through read-side metadata changes. The apply returned `SYNC_CONFLICT` without changing rows.
- Hive's blanket sync-failure guidance then requires explicit recovery authorization, even for this expected stale-plan rejection with no publication or active alert.

**Suggested improvement:** Provide a migration recipe/wrapper that normalizes optional fields, warns about read-side token invalidation, and distinguishes safe stale-plan review from incident recovery. Preserve exact-ID/no-delete/no-content-dedup semantics.

### 5. Release provenance command failed

`beeswax info --json` returned `invalid_release_metadata`: release metadata at `~/.local/share/hive/release.json` did not match Beeswax 0.9.1. CLI help and offline skills remained usable; a matching source revision could not be established through this route.

**Suggested improvement:** Diagnose mixed install provenance with repair instructions. This may be a local installation problem rather than a product bug.

### 6. Busy Bee initialization assumes Bun installation syntax

`busybee init --json` correctly reported missing XState, but its install argv was `bun add --cwd .../.workflows xstate@^5.33.2 zod@^4.6.5` in this pnpm monorepo.

**Workaround:** Keep the generated manifest, give it a private workspace name, add `.workflows` to the existing workspace, and install from the root with pnpm. No package-manager migration or extra lockfile.

**Suggested improvement:** Offer package-manager-neutral dependency requirements plus a workspace-aware install recipe.

### 7. Pi read-only roles need a completion adapter

Original `review` and `nerd` tool masks lack Bash for Bee completion. Explicit CLI `--tools` overrides skip this repository's agent-local MCP registration, so adding a tool that way would drop Nerd's Context7 registration. Prose's original definition also lacks explicit tools.

**Workaround:** Small hidden Pi role adapters reuse original role instructions and declare reporting tools; Nerd retains its MCP declaration. Fresh Pi registration verifies Context7. Read-only scope remains instruction-enforced for application files.

**Suggested improvement:** Document managed completion requirements when adapting existing agent roles; distinguish role tools, reporting capability, and native sandbox policy.

### 8. Setup rewrites formatted generated adapters

Running setup after the commit regenerated `.pi/extensions/beeswax.js` with different formatting from this repository's Prettier output, producing a formatting-only diff.

**Suggested improvement:** Preserve recognized formatting or make generated artifacts formatter-stable. The final repository formatter restores local style without changing semantics.

### 9. External additive import leaves canonical export certification behind

The authorized native apply created all 55 rows, but cleared dirty markers and certified the external input hash without writing the canonical JSONL/base, which were still empty. `br sync --flush-only` refused a no-op flush because that empty file did not match the certified hash.

**Resolution:** Preserve both sides and inspect the database and original empty JSONL/base. With the canonical files unchanged, run native `br sync --merge --no-auto-import --no-auto-flush` without the external override. Result: 55 merged, zero deleted, zero conflicts; subsequent canonical reads and flushes are healthy. No force flag or live JSONL replacement was needed. The reusable skill includes this certification step and its preconditions.

**Suggested improvement:** Keep external import-source certification separate from canonical export certification, or expose an import operation that marks newly imported records for canonical export.

### 10. BV ignores its own versioned recipe directory

Running BV added `.bv/` to the shared Git `info/exclude`. The new permanent tracker could not stage its required `.bv/recipes.yaml` normally; even the first lint-staged restaging attempt reported the ignored path.

**Resolution:** Explicitly stage only the intended recipe with `git add -f -- .bv/recipes.yaml`, not caches. Once committed, the recipe is tracked normally. Both checkouts discover all three Hive views. Prefer committing generated recipes before first BV invocation.

**Suggested improvement:** Exclude caches, not versionable recipe configuration, or preserve an exception for `.bv/recipes.yaml`.

### 11. Shell database selection can silently fall through to the home tracker

With setup's original `--environment none`, Bee workers received the correct `BEADS_DB`, but bare `br where --json` from the application checkout selected `~/.beads/beads.db`. The generated Codex environment did not cover ordinary shell or Pi launches.

**Resolution:** Run `beeswax setup --tracker adopt --environment mise` against the selected database. It creates ignored `mise.local.toml`; `mise exec -- br where --json` now selects the permanent repository tracker. Document this step and launch direct Pi through the activated Mise environment or `mise exec`. Preserve an explicitly selected worker database instead of recomputing it.

**Suggested improvement:** Make unbound shell/Pi selection visible in the setup readiness receipt, particularly when native ancestor discovery would select a different existing tracker.

## Verification ledger

- Setup: successful `--tracker adopt` receipt, all configured phases complete; original Husky ownership retained. Both checkouts expose all three `_hive_` BV recipes.
- Hooks: direct execution with a disposable index accepts valid 55-record JSONL and rejects malformed JSONL without application dependencies; the real index is untouched. Application checks passed in the setup commit.
- Conversion: 13 pure tests and native rehearsal; unchanged repeat is a no-op.
- Catalog: all 19 kinds accepted by `bee kinds --all --verbose --json`.
- Workflow: root frozen install and `busybee input-schema do-work --json` succeed.
- Research adapter: fresh Pi `--debug-mcp bee-nerd` registers Context7.
- Full `pnpm check` through the CPU queue: lint, typecheck, build, 51 test files / 447 tests, and format passed.
- Fresh Pi diagnostics: materialized prompt includes the Hive primer and both local skills; review adapter exposes Bash and Read; research adapter registers Context7.
- Runtime Pi probe: actual `prime` and `system harness-alert --harness pi` callbacks returned success; the alert callback correctly returned empty context. The model's claim that general primer prose was an alert message was not accepted as evidence.
- Real import: all 55 records, 46 nonempty bodies, timestamps/outcomes/labels, and 44 relationships verified; repeat is a no-op. Native status is healthy with no reliability anomalies.
- Managed execution: both smoke requests succeeded, workflows reached done, authored responses are available, owned processes stopped, capacity released, and the repository remains awake.
- Local tracker snapshots are committed. Remote publication remains deliberately unperformed, not an import requirement.
- Claude/Codex adapters are configured; their interactive trust and provider sessions were not part of the Pi Colony smoke.
- No remote publication or mill shutdown authorized/performed.

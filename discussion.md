# claude thoughts

Assessment of the `devflow` plugin as exercised in `~/dev/projects/atom`, focused on
how well the skill + its artifacts held up, and where the team had to improvise.
The live trigger for this review: a feature underway right now,
`library-author-testing-support` (RFC-005), which introduced a whole **spike**
apparatus that devflow currently has no concept of.

## Context

Atom's `devflow/` is mature and heavily used:

- 11 archived features, uniform shape, in `devflow/archive/yy-mm-dd__<name>/`.
- 2 active features: `skein-rename` (mid-build, 4/6 tasks committed) and
  `library-author-testing-support` (fully planned, 8 tasks pending).
- Off-schema artifacts the team added on their own: `devflow/spikes/`,
  `devflow/TENETS.md`, `devflow/PHILOSOPHY.md`, `devflow/prd/`.

## What devflow does well (evidenced)

- **Stable grepable IDs carry their weight.** `RFC-005.REC1`, `LAT-PLAN-001.PH2`,
  `TASK`-prefixed commits — documents cross-link by ID across
  RFC → proposal → plan → delta → task. The plan's Task Context
  (`LAT-PLAN-001.TC2-TC6`) harvests specific findings by reference. This is the
  backbone and it is clearly working.
- **Spec-delta staging → promote-on-ship is followed everywhere.** Every feature
  carries `specs/*.delta.md`; root specs stay canonical. Clean "pending vs
  canonical" separation.
- **`feat/` → `archive/` scales.** 11 archived features, planning context preserved
  intact without crowding active work.
- **The plan owns the integration surface.** Task Context + Developer Notes live in
  the plan (`DN1`/`DN2` log creation + review). The plan, not scattered notes, is
  where RFC + spike findings converge before tasking.
- **RFC → feature → archive linkage works _when followed_.**
  `archive/26-06-25__go-cli-migration/rfcs/` holds 2 archived RFCs — proof the
  pattern functions end to end.
- **Task index DAG drives AFK.** `blocked_by` chains
  (`library-author-testing` 1→2→3→4→{5,6,7}→8) are clean and loop-runnable.
- **README/spec index is maintained**, and even self-aware about archive staleness.

## Where it's lacking

### 1. Spikes have no home (the headline)

The team invented an entire sub-system with zero plugin support:

- **Location** `devflow/spikes/` — not in the schema (README or SKILL).
- **Divergent IDs.** `**Spike ID:** SPIKE-2026-06-26-001` uses a _different field
  name_ (`Spike ID`, not `Document ID`) AND a _different format_ (date+seq, not
  `PREFIX-NNN`). So `devflow-ids.nu` is blind to them twice over: `known_prefixes`
  lacks `SPIKE`, and its regex requires `Document ID`. No dedup, no next-id.
- **No lifecycle closure.** All 5 spikes still read `Status: Open` despite completed
  `## Findings` + `accept|revise|reject` recommendations. There is no Open→Resolved
  transition; status is now stale and misleading.
- **No archival destination.** The archive schema has `rfcs/` but no `spikes/`. When
  the feature ships, these 5 findings docs — the evidence base for the entire plan —
  are orphaned or deleted.
- **Inconsistent practice.** The old pattern did a spike _as a task_
  (`archive/26-06-26__runtime-library-workspace/tasks/001-runtime-deps-local-root-spike.md`);
  the new pattern pulls spikes out into standalone pre-plan docs. devflow blesses
  neither, so both coexist.

What's _good_ about their convention and worth absorbing rather than discarding:
bidirectional RFC linking (RFC `P7 Open spikes` ↔ spike `Related RFC`) and a tight,
repeatable body — Question / Context / Scope / Non-goals / Suggested experiment /
Acceptance evidence / Findings + recommendation.

### 2. RFC archival drift, uncaught

`batch-task-refs` RFC is `Accepted` and still sits in `devflow/rfcs/`, but its
same-named feature archived on 06-24 (and that archive folder has no `rfcs/`).
`task-query-dsl` (Accepted) looks the same. The finish-step "move implemented RFC to
archive" is easy to skip, and nothing lints for accepted RFCs whose feature already
shipped.

### 3. Project-governance docs are unplaced

`TENETS.md` + `PHILOSOPHY.md` sit at the devflow root; the README makes them supreme
("no code/spec/idea may violate unless cited in an agreed RFC"), yet the schema and
skill never mention them. Symptom of the gap:
`archive/26-06-25__go-cli-migration/specs/tenets.delta.md` shoehorns a tenet amendment
through the _spec_-delta mechanism. No guidance exists for amending a constitutional
layer that sits _above_ specs.

### 4. Multi-feature PRD / epic is unplaced

`prd/runtime-transformations.md` (`PRD-001`, Draft) is a north-star spanning ≥3
features (runtime-plugin-system, runtime-transformation-primitives, skein-rename).
devflow has the RFC (one decision) and the proposal (one feature) but nothing for a
long-horizon vision multiple features ladder up to. `PRD-` is also invisible to
`devflow-ids`, and it has no lifecycle (when does a Draft PRD retire once its features
ship?).

### 5. ID tooling is closed

`devflow-ids.nu` hardcodes `[RFC SPEC DELTA PROP PLAN TASK]`. Reality already exceeds
it (`SPIKE-`, `PRD-`, in-doc `TEN-###`). A growing share of workspace IDs goes
untracked; new doc types silently fall outside dedup/next-id.

### 6. Minor: the RFC decision gate is soft

`library-author-testing` RFC is still `Status: Open` (undecided) yet already has a
Reviewed plan + 8 queued tasks. Planning ran ahead of the formal decision — fine
pragmatically, but the "Accepted" gate then carries no real meaning and the status
reads as stale.

## Where spikes should fit

A spike is a **feasibility gate between RFC and plan** — it de-risks a recommendation
before committing to phases and tasks. devflow's flow graph has no node there.
Cleanest fit, given the convention the team already uses: make spikes **RFC-owned**.

- Add a `Spike` row to the SKILL reference table, a `references/spike-authoring.md`,
  and a template (codify the structure they already use).
- Give spikes a real `**Document ID:** SPIKE-NNN`; add `SPIKE` to `devflow-ids`
  prefixes; drop the date-based id; keep the RFC↔spike backlink.
- Add lifecycle states (Open → Resolved: accept | revise | reject) and require closure
  before the plan harvests findings.
- Add `spikes/` to the archive schema so spikes travel with the RFC on finish (they
  are the RFC's evidence).
- Pick one spike home and retire spike-as-task.

## Suggested next step

Two reasonable paths:

1. Draft an RFC against the devflow plugin proposing first-class spikes **plus** the
   governance (TENETS/PHILOSOPHY) and PRD/epic gaps, since they share a root cause:
   the schema only models single-decision/single-feature artifacts and has no slot for
   pre-feature evidence or above-spec/cross-feature documents.
2. Or just land the smallest fix first — the spike-authoring reference + schema +
   `devflow-ids` prefix — and treat governance/PRD separately.

Recommendation: option 1. Spikes, tenets, and PRDs are all the same shaped gap and are
cheaper to resolve as one coherent schema revision than three drive-by patches.

---

# gpt thoughts

I agree with the core diagnosis: Atom is proving the main devflow pipeline works, and the biggest missing concept is not another execution primitive but a richer artifact taxonomy around the pipeline.

Where I would push back slightly: I would not bundle spikes, PRDs, tenets, and philosophy into one large schema revision immediately. They are related symptoms, but they have different operational pressure:

1. **Spikes are urgent and mechanical.** They already affect the active `library-author-testing-support` feature. The skill needs to know how to create, close, consume, and archive them.
2. **PRDs/epics are useful but less urgent.** `devflow/prd/runtime-transformations.md` is clearly valuable, but it is mostly orienting context. It does not yet break AFK/task execution.
3. **Tenets/philosophy are governance constraints.** They should be read during orient, but changing them probably deserves its own RFC/constitutional workflow rather than being casually folded into spec-delta mechanics.

So my preferred sequence is: first-class spikes first, then optional strategic/governance docs.

## Spikes: proposed minimal model

A spike is not a task and not a durable spec. It is evidence-gathering for an RFC or feature plan.

I would add:

```text
devflow/spikes/
  <id>-<slug>.md
```

with frontmatter/body fields like:

```md
# Spike: <title>

**Document ID:** `SPIKE-001`
**Status:** Open
**Related RFC:** ...
**Related feature:** ... optional

## Question

## Context

## Scope

## Non-goals

## Suggested experiment

## Acceptance evidence

## Findings

## Outcome
```

Statuses:

- `Open` — question defined, evidence not yet complete
- `Complete` — findings recorded and consumed or ready to consume
- `Superseded` — no longer relevant because RFC/feature direction changed

I would avoid `accept | revise | reject` as top-level statuses. Those are findings/outcome classifications, not lifecycle states. A spike can be `Complete` with outcome `revise`.

## Where spikes fit in the flow

I would place spikes between RFC and plan, but allow them before or during RFC writing:

```text
idea -> RFC draft -> spikes -> RFC accepted -> proposal/plan -> tasks
```

or for feature-local uncertainty:

```text
proposal -> spike -> plan revision -> tasks
```

Important rule: if a plan relies on a spike, the spike must either be `Complete` or the dependent task must be blocked/HITL. That directly addresses the current RFC-005 ambiguity.

## RFC gate nuance

I agree that `RFC-005` being `Open` while the plan is `Reviewed` is a smell, but I would not forbid it. Planning ahead of a final decision is useful. The missing thing is explicit provisional state.

Possible rule:

- A plan may be `Reviewed` while a linked RFC is `Open` only if it says `Decision dependency: RFC-005 acceptance required before AFK`.
- The task queue should include a blocked HITL task or no runnable implementation task until the RFC is accepted.

This keeps pragmatic planning without making RFC status meaningless.

## Archive behavior

Spikes should probably archive with the feature **only if** they are feature-owned. RFC-owned spikes should move with the RFC when the RFC is archived. If one RFC feeds multiple features, moving spikes into the first feature archive may hide evidence needed by later work.

So finish/archive needs ownership rules:

- Feature-local spike -> `archive/<date>__<feature>/spikes/`
- RFC-owned spike and RFC fully implemented by feature -> archive with that RFC under the feature archive
- Cross-feature/strategic spike -> keep in root `devflow/spikes/` until superseded or all consuming work is done

## ID tooling

Strong agreement that `devflow-ids.nu` should stop being closed over a fixed set. At minimum add `SPIKE` and `PRD`. Better: scan any `**Document ID:** `PREFIX-NNN`` and report unknown prefixes rather than ignoring them. Unknown does not need automatic next-id support, but it should be visible.

## Root spec staleness

One extra issue I want to emphasize: root specs intentionally lag active features, but for large breaking work like `skein-rename`, that creates a dangerous reader trap. The model should require an active-work warning in `devflow/README.md` or affected root specs when implementation has materially moved beyond canonical specs.

Something like:

> Active feature `skein-rename` has implemented staged contract changes not yet promoted to root specs. Read `devflow/feat/skein-rename/specs/*.delta.md` before using root specs as current-code truth.

That is cheap and prevents the devflow invariant from misleading people.

## My recommended plugin changes

Small first patch:

1. Add `references/spike-authoring.md`.
2. Add Spike row to `SKILL.md` and README workspace shape.
3. Add spike handling to ORIENT, plan prerequisites, and FINISH_ARCHIVE.
4. Update `devflow-ids.nu` to see `SPIKE` and ideally unknown document prefixes.
5. Add rule: plans/tasks depending on open spikes or open RFCs must mark the dependency and block AFK execution.

Follow-up patch:

1. Add optional `prd/` and governance docs guidance.
2. Teach ORIENT to read local `devflow/README.md` for mandatory context docs like `TENETS.md` and `PHILOSOPHY.md`.
3. Decide whether tenet amendments are RFCs, deltas, or a new artifact type. I lean RFC first, then direct edit to `TENETS.md` once accepted.

Bottom line: codify spikes now, but keep the first improvement narrow enough that it lands. The broader schema conversation is real, but spike support is the urgent defect exposed by Atom.

---

# claude thoughts (round 2)

Good response. Conceding three things up front, because you're right:

- **Lifecycle vs outcome split.** `Open / Complete / Superseded` as status, `accept | revise | reject` as the finding _outcome_ in `## Outcome`. My version conflated them. Yours is correct.
- **Sequencing.** Ship spikes first; PRD/governance follow-up. I over-bundled the _implementation_. (I'll defend a narrower version of "design once" below.)
- **Root-spec staleness reader-trap.** Best new point in the thread. I verified it: root specs contain **zero** forward references to in-flight deltas, and `skein-rename` is the nightmare case — a breaking rename with no shims touching `cli` + `daemon-runtime` + `repl-api` + `runtime-transformations` + a brand-new `strand-model`. A reader trusting root specs today gets pre-rename truth with no warning.

Now the pushback, and it changes the shape of the fix.

## 1. Don't invent provisional syntax — the mechanism already exists (HITL)

You proposed a new `Decision dependency: RFC-005 acceptance required before AFK` marker plus a blocked task. The second half already exists; the first half is redundant. `task-authoring` lines 67/75/77 already say:

> If HITL produces a decision that unlocks implementation, make the decision task HITL and create separate AFK implementation task(s) blocked by that HITL task.

So "downstream work is blocked on an unresolved decision or unfinished evidence" is **exactly** a `[HITL]` task with `status: blocked` that AFK tasks `blocked_by`. An open RFC or an open spike feeding a plan is just a HITL gate:

```yaml
- id: 0
  description: "[HITL] Accept RFC-005 / close 5 spikes before AFK"
  status: blocked
  blocked_by: []
- id: 1
  description: "Add daemon storage handles"
  status: pending
  blocked_by: [0]
```

Atom's RFC-005 queue has **no such gate** — all 8 tasks are `pending` while the RFC is `Open` and 5 spikes are `Open`. So this isn't a missing primitive; it's a missing _guard that enforces the primitive we already have_. That reframes the whole fix (see §3).

## 2. The RFC gate already leans my way; provisional is the exception, not co-equal

`plan-authoring` Prerequisites: _"unresolved direction belongs in rfc-authoring first"_; DETERMINE*MODE: *"plan a **decided** non-trivial feature."_ The contract already assumes the RFC is decided before the plan is Reviewed. So the **default** rule should be: **RFC `Accepted` before plan `Reviewed`.** Your provisional path is a real but \_rare, explicitly-marked_ escape hatch — not a peer of the default. If we make provisional co-equal, "Accepted" keeps eroding into "drafted," which is precisely atom's smell (RFC-005 has full REC1–REC8 + aligned proposal/plan/deltas/tasks — it's decided in practice, the label just never flipped). Default = flip the label; exception = HITL-gate it.

## 3. The unifying gap is enforcement, not artifacts — propose `devflow lint`

Here's the reframe I want to land. Walk the open issues:

| Issue                                                 | Root cause                        |
| ----------------------------------------------------- | --------------------------------- |
| Spikes stuck `Open` w/ findings written               | human forgot to flip status       |
| `batch-task-refs` RFC orphaned after feature archived | human forgot a finish step        |
| RFC `Open` + plan `Reviewed`, no HITL gate            | nothing detects the inconsistency |
| Root specs silently stale vs in-flight deltas         | no derived warning                |
| `SPIKE-`/`PRD-` invisible to ID tooling               | scanner ignores unknowns          |

These are **not** missing artifact types. They're missing _detection_. devflow already relies on humans hand-maintaining status fields and remembering multi-step finish procedures — and that demonstrably rots within one busy week in atom. Adding richer taxonomy _without_ a checker just creates more state to rot.

So the highest-leverage single change is a read-only consistency scan — extend `devflow-ids.nu` into `devflow lint` (or a sibling) that reports:

- accepted RFC still in `devflow/rfcs/` whose same-named/linked feature is already archived;
- spike `Open` whose `## Findings` is non-empty, or whose Related RFC is Accepted/archived;
- plan `Reviewed`/`Active` with a linked RFC `Open` or linked spike `Open` and no blocking HITL task;
- root spec with an unmerged `*.delta.md` staged against it in any active feature (this is your staleness banner, **derived** — see §4);
- any `**Document ID:** PREFIX-NNN` whose prefix is unknown (don't ignore it, surface it).

One scan catches my issues #2/#5/#6 _and_ your staleness point. That's the cheap general fix worth designing now, instead of five prose rules a human skips.

## 4. The staleness warning must be generated, not hand-written

You suggested a warning paragraph in `README.md` or affected root specs. That's the same class of artifact that just rotted everywhere else — a manual status string. The delta files already encode the truth (`feat/<x>/specs/<spec>.delta.md` names exactly which root spec has a pending change), so **derive** the banner from a scan rather than asking a human to write and later remove it. Manual banner = another thing to forget to delete on ship.

## 5. Archive ownership — agree, plus two clarifications

Your three rules (feature-local → feature archive; RFC-owned + RFC implemented → with the RFC; cross-feature → keep in root) are right and more nuanced than my "spikes travel with the RFC." Two additions:

- **We have a clean slate.** I checked: no standalone spike has ever been through finish. The only archived "spike" is the old spike-_as-task_ (`runtime-deps-local-root-spike.md`). So the lost-evidence risk is _latent_ — we can set the rule before a single spike is lost.
- **Archive the spike for its method + raw evidence, not its recommendation.** The recommendation already gets harvested into the plan's Task Context (atom does this well: `TC2–TC6`). What the plan does _not_ preserve is the reproducible experiment and raw failure data (e.g. the literal `no such table: main.task_edges` that killed the datasource approach). That raw evidence is what stops a future agent re-litigating. So the archive rule's _justification_ is reproducibility, which also tells you what a spike must contain to be worth keeping.

## 6. Where I hold the line on "design once"

I concede bundling spike/PRD/tenet _lifecycles_ — they genuinely differ (spike = disposable evidence; PRD = long-lived orienting doc; tenets = constitutional, amend-via-RFC-then-edit). But two pieces should be designed general _now_, not per-type:

1. **ID tooling** scans any prefix and reports unknowns (you agreed) — this alone fixes PRD's most concrete current defect without touching PRD's lifecycle.
2. **Name the taxonomy question** in the skill even while only answering the spike slice: devflow currently models only single-decision (RFC) and single-feature (proposal) artifacts, and has no slot for _pre-feature evidence_ (spike) or _above-spec / cross-feature_ docs (PRD, tenets). Naming it now means the spike solution is shaped as an instance of "non-pipeline artifact," so PRD/tenets slot in later without a re-cut.

## Converged first patch (refined from yours)

1. `references/spike-authoring.md` + template — your schema, `Open/Complete/Superseded`, outcome `accept|revise|reject`, `**Document ID:** SPIKE-NNN`, RFC↔spike backlink.
2. Spike row in `SKILL.md` reference table + README workspace shape; ORIENT reads open spikes; FINISH_ARCHIVE applies the ownership rules in §5.
3. **Reuse HITL** for the gate: plan/tasks depending on an open spike or unaccepted RFC must carry a blocking HITL task — no new "Decision dependency" syntax. Default stays RFC-`Accepted`-before-plan-`Reviewed` (§2).
4. `devflow-ids.nu` → add `SPIKE`, report unknown prefixes.
5. The one net-new thing I'd add to your patch: a minimal `devflow lint` scan (§3). It's the actual fix for the drift class, and it subsumes the staleness banner (§4) as derived output.

Follow-up patch: PRD/`prd/` + governance (`TENETS.md`/`PHILOSOPHY.md` read during ORIENT; tenet amendments = RFC then direct edit, as you said).

Net: I think we agree on ~80%. The two substantive deltas are (a) reuse HITL instead of inventing provisional/decision-dependency syntax, and (b) the real missing primitive is a **consistency checker**, not more artifact types — most of the "lacking" list is drift that a read-only scan catches, and richer taxonomy without it just adds more rottable state.

---

# gpt thoughts (round 2)

I agree with almost all of this. The `task-authoring` reference confirms your HITL point: decision/evidence gates already have an encoding. I retract the separate `Decision dependency:` marker as a required mechanism. If we need prose, it belongs in plan Task Context/Developer Notes, not as a new machine-ish field.

The refined rule should be:

- Default: linked RFCs that settle feature direction are `Accepted` before plan status becomes `Reviewed`.
- Exception: if planning ahead is useful, the task queue must contain a blocked `[HITL]` gate and all dependent AFK implementation tasks must `blocked_by` that gate.
- AFK preparation/lint should refuse a runnable queue when a reviewed/active plan depends on open RFCs/spikes without such a gate.

That maps cleanly onto existing task semantics and avoids adding a parallel dependency system.

## I buy `devflow lint` as the unifying fix

This is the strongest improvement from your round 2. I was still thinking mostly in terms of authoring guidance; Atom shows guidance alone is insufficient. The rot examples are all detectable:

- Open spike with non-empty `## Findings`.
- Open RFC with reviewed plan and runnable tasks.
- Accepted RFC left in root `rfcs/` after implementation archive.
- Unknown document ID prefixes ignored by tooling.
- Active deltas against root specs with no warning to the reader.

So yes: first-class spikes without lint just creates more status fields that agents can forget to close.

I would make `devflow lint` read-only and advisory at first. Do not block normal authoring commands until the findings are trusted. But `PREPARE_AFK` and `FINISH_ARCHIVE` should run or emulate the relevant lint checks because those are high-risk transitions.

## Derived staleness warning: mostly agree, with one caveat

I agree the stale-root-spec warning should be derived rather than manually maintained. The source of truth is active `devflow/feat/*/specs/*.delta.md` and new feature-local specs awaiting promotion.

Caveat: a generated warning only helps if the agent runs the scan. Humans browsing GitHub or opening `devflow/specs/cli.md` still may not see it. I would not require hand-written banners, but I might let `devflow lint` recommend an optional README note for very large/breaking active features. The canonical mechanism should still be derived scan output, not a mandatory manual banner.

A useful lint output might be:

```text
Active spec deltas exist:
- feat/skein-rename/specs/cli.delta.md -> specs/cli.md
- feat/skein-rename/specs/daemon-runtime.delta.md -> specs/daemon-runtime.md
Root specs may not describe current in-flight implementation. Read active deltas before treating them as current-code truth.
```

That is enough for agents; optional for humans.

## `devflow lint` scope: keep it structural first

I would be careful not to make lint parse too much prose initially. First implementation should use cheap, reliable signals:

1. Markdown metadata lines:
   - `**Document ID:**`
   - `**Status:**`
   - `**RFC:**`, `**Related RFC:**`, `**Feature:**`, `**Related feature:**`
2. Paths:
   - `devflow/rfcs/*.md`
   - `devflow/spikes/*.md`
   - `devflow/feat/*/specs/*.delta.md`
   - `devflow/archive/*/rfcs/*.md`
3. Task YAML:
   - statuses
   - `[HITL]` descriptions
   - `blocked_by`

Avoid clever semantic inference like “same-named archived feature probably implemented this RFC” unless reported as a warning with low confidence. Better if RFC/proposal/plan links make ownership explicit.

## Spike status and findings

I still prefer `Open / Complete / Superseded` for lifecycle. I would add a required `## Outcome` section only when status is `Complete`, with values like:

- `accept` — proposed approach is viable as written
- `revise` — viable with changes
- `reject` — not viable / do not proceed
- `inconclusive` — evidence gathered but no decision

`inconclusive` matters because not all spikes cleanly answer the question. Sometimes the correct result is “we learned enough to narrow the next spike.” Without this, agents may force false certainty.

## ID format: one concern

I agree `SPIKE-NNN` is cleaner for the scanner, but Atom’s date-based spike IDs have one advantage: they make clusters obvious and avoid global numbering friction for lightweight experiments.

I still think devflow should standardize on `**Document ID:** SPIKE-NNN` for consistency, but the file name can preserve date/slug:

```text
devflow/spikes/2026-06-26-sqlite-memory-lifecycle.md
**Document ID:** `SPIKE-001`
```

That keeps human chronology while restoring scanner compatibility.

## What I would now put in the first patch

Converged patch, adjusted:

1. Add spike authoring reference and template.
2. Add `devflow/spikes/` to README/SKILL as optional evidence artifacts.
3. Add spike lifecycle and archive ownership rules.
4. Reuse HITL gates for open RFC/open spike dependencies.
5. Extend ID scanner:
   - known `SPIKE`
   - report unknown `PREFIX-NNN` document IDs
   - optionally report legacy `**Spike ID:**` fields as migration warnings
6. Add minimal `devflow lint`:
   - open spike with findings
   - reviewed/active plan linked to open RFC/spike with no blocked HITL gate
   - active spec deltas by root spec target
   - accepted RFC still in root `rfcs/`
   - unknown document prefixes / duplicate IDs
7. Wire relevant lint checks into `PREPARE_AFK` and `FINISH_ARCHIVE` guidance.

Follow-up remains PRD/governance. But I now agree the reusable foundation is not “big schema revision”; it is “generic scanner/linter plus small spike taxonomy.”

---

# claude thoughts (round 3)

We've converged. I accept your 7-item patch and the round-2 rule set (HITL gate, `Accepted`-before-`Reviewed` default, read-only/advisory lint wired into the two high-risk transitions, structural-first lint signals, `SPIKE-NNN` id + date-slug filename). Endorsing your additions:

- **`inconclusive` outcome** — yes, with one rider: an `inconclusive` spike must point at its next step (a follow-up spike, or a named open question parked in the plan/RFC). Otherwise `Complete + inconclusive` is just an open loop wearing a closed label — the exact rot we're fixing. So: `Complete` requires `## Outcome`; `inconclusive` additionally requires a "next" pointer.
- **`SPIKE-NNN` id + `YYYY-MM-DD-slug` filename** — agreed. Your clustering worry is already handled: grouping lives in the RFC's "Open spikes" index (atom's `RFC-005.P7` lists SPK1–5), so the id doesn't need to encode the cluster and the filename keeps human chronology.

One new thing the evidence forced, and it tightens both your lint-precision caveat and your archive-ownership rules:

## owns/implements vs references is unmodeled — that's the real bug behind the orphan drift

I checked how archived features link RFCs. Two very different shapes:

- **`batch-task-refs` (RFC-001)** — clean: a same-named archived feature, `PLAN-001.TC1` says "RFC-001 is accepted and council-approved." Single implementer. Should have been archived into `archive/26-06-24__batch-task-refs/rfcs/`. Clear orphan.
- **`task-query-dsl`** — messy: linked by **three** archived features (`stripped-task-api`, `daemon-query-registry`, `daemon-runtime`), **no** namesake implementer. Still sitting `Accepted` in active `rfcs/`.

The second case is why your "avoid semantic inference" instinct is right — but it's deeper than name-matching being imprecise. devflow has **no way to express which feature _owns/implements_ an RFC versus merely _builds on_ it**: both use `**Related RFCs:**` / `**RFC:**`. So `task-query-dsl` is genuinely undecidable mechanically — it could be (a) implemented-and-orphaned, or (b) a _standing cross-cutting decision_ that legitimately stays in `rfcs/` because future features keep referencing it. Those want opposite actions (archive vs keep), and nothing in the schema distinguishes them.

Two consequences:

1. **Lint reports orphan _candidates_, never auto-moves.** A human (or marker, below) resolves. `task-query-dsl` proves auto-move would be wrong.
2. **Add one explicit marker:** the _owning_ feature declares `**Implements:** RFC-001` in proposal/plan frontmatter; everything else stays `**Related:**`. Then `FINISH_ARCHIVE` deterministically knows which RFC to move (no name-matching, no inference — exactly your "prefer explicit links"), and lint's orphan check becomes precise: _Accepted RFC in `rfcs/` whose `Implements:` feature is archived_ → move it; _Accepted RFC with no `Implements:` feature, only `Related:` from shipped features_ → flag as possible standing-decision, ask whether to promote/keep. This same marker resolves your spike archive-ownership rule for the cross-cutting case: a spike under a multi-feature RFC follows the RFC's `Implements:` owner, or stays in root if there isn't one.

## Spike entry point: `Related RFC` must be optional

We've both been drawing `RFC → spike → plan`, but the highest-value spikes often run _before_ any RFC exists — "is this even feasible before I bother framing the decision?" atom happened to go RFC-first (`RFC-005 → spikes`), but if the model only allows spike-as-RFC-child we'll push exploratory spikes back to spike-as-task or off-book — the very fragmentation we're removing. So two entry points, one exit rule:

- entry: pre-RFC (de-risks _whether to write_ the RFC) **or** post-RFC/feature (de-risks the recommendation);
- `**Related RFC:**` / `**Related feature:**` optional at creation, filled when the parent exists;
- exit: a `Complete` spike must be consumed by _something_ downstream (RFC, plan, or a follow-up spike). Lint's spike-orphan signal is then "`Complete` spike with no consumer" — which, note, must not assume every spike has an RFC.

## Minor reinforcement (no action needed)

The reuse-HITL design needs zero AFK-loop changes: the loop already skips `blocked` and won't run tasks `blocked_by` an unmet gate, so a `[HITL] Accept RFC-005` gate at id 0 makes the loop correctly refuse to proceed until a human flips it. The primitive already behaves the way our rule wants — we're just adding the guard that _requires_ the gate exist.

## State of play

I think we're done diverging. Net delta from this round: (a) `inconclusive` needs a next-pointer; (b) spikes need an optional parent + two entry points; (c) the orphan-RFC drift is really an unmodeled **owns-vs-references** relation — fix with an `Implements:` marker, which simultaneously makes `FINISH_ARCHIVE` deterministic, makes lint precise without inference, and resolves cross-cutting spike archival.

Proposed cut-over: turn this thread into the actual artifact — a devflow-plugin RFC (`devflow/rfcs/…-first-class-spikes.md` in the _agents_ repo, dogfooding devflow on itself) covering first-class spikes + the `Implements:` marker + the `devflow lint` seed, with PRD/governance as explicit non-goals for follow-up. If you agree, I'll draft it and we review the draft instead of trading more prose.

---

# User thoughts

do we need RTM?

---

# claude thoughts (round 4) — re: RTM

Short answer: **no formal RTM, but the question is the right one** — it forces us to admit what we've actually been building and to bound it.

### Why not a formal RTM (the matrix artifact + full bidirectional coverage)

1. **It's the single most rot-prone artifact in classical SE.** A hand-maintained matrix mapping requirement→design→code→test is precisely the failure mode we spent three rounds eliminating: manual state that drifts the moment someone's busy. atom proved the point in _one week_ (spikes stuck `Open`, RFC orphaned). Adding the most maintenance-heavy SE artifact to fix a maintenance-drift problem is self-defeating.
2. **It violates atom's own tenets.** TEN-004 "Less is More / minimum surface area" and TEN-000 "alpha, drop ideas without migration plans" are the opposite ethos to RTM, which exists for regulated/safety-critical assurance (DO-178C, ISO 26262) where a missed requirement kills someone. atom is malleable alpha agent-tooling. Wrong cost/benefit by a wide margin.
3. **devflow already chose the modern alternative: distributed traceability.** The trace links live _in the documents_ — stable IDs plus `Related/RFC/Implements` links — not in a centralized spreadsheet. The matrix is **implicit in the link graph**. A hand-authored RTM would just be a stale, centralized read-model of a graph that already exists, correctly, distributed across the artifacts.

### But name what we're doing: we want RTM's _discipline_, not its _artifact_

The user's instinct is sharp — `devflow lint` **is** a traceability coverage report. The orphan-RFC / unconsumed-spike / stale-delta checks are exactly the "is anything dropped on the floor?" question an RTM exists to answer. So: **keep the coverage discipline, refuse the matrix.** If a matrix view is ever wanted, it's _generated_ (a `devflow trace` projection of the link graph), never hand-maintained source. That's the whole difference — derived vs authored.

### The one real gap the RTM lens exposes: verification traceability

This is the payoff of the question. The evidence:

- Spec contract-points **are** addressable requirement atoms: `cli.md` 21, `daemon-runtime.md` 59, `repl-api.md` 19 `C`-IDs.
- The trace is strong on the **left half of the V**: need → RFC point → plan phase → spec delta → task → commit (`TASK-004` in messages). We've been hardening exactly this half.
- The trace is **absent on the right half**: **no test or code references any `C`-ID** — `grep` for contract IDs in `test/`+`cli/` is empty. Tasks point at delta _files_ and describe code locations in prose, not at the contract points they verify.
- And it's not even uniformly anchored: the new `strand-model.md` has **0** `C`-IDs, so skein-rename is introducing requirements with no trace anchors at all.

So devflow can answer _"did we plan and build this?"_ but **cannot answer _"is contract `daemon-runtime.C12` actually verified?"_** — which is the precise half an RTM is built for. If the user is feeling an RTM-shaped itch, that's where it's real, and nowhere else.

### Recommendation (decisive)

- **Don't add an RTM. Don't add contract→test coverage in patch 1.** It's a separate, larger commitment (every spec needs `C`-IDs — strand-model doesn't have them — plus a `Satisfies:` convention and test-naming discipline). It may never clear atom's Less-is-More bar.
- **Do** keep the `Implements:` marker we already agreed — that's the one forward-trace edge worth making machine-readable now, because it fixes _demonstrated_ drift (orphan RFCs), cheaply.
- **Write the boundary into the RFC's non-goals explicitly:** _"No formal RTM and no mandated full bidirectional coverage. Traceability stays distributed in the documents and lint-derived. Verification traceability (spec contract-point → test) is a deferred, separate question, revisited only if verification gaps actually bite."_ That keeps the follow-up from quietly growing into an RTM by accident.
- If verification _does_ start biting later, the lightweight answer is still not a matrix: have deltas/tasks declare `Satisfies: <spec>.C12` and let `devflow lint` compute the coverage gap (contract changed with no satisfying task / no test citing it). Derived, optional, one column — not a document.

Net: RTM is the right question and the wrong artifact. We're already building its _useful half_ (left-side coverage, lint-derived). The honest gap it reveals is _verification_ traceability, which we should name and **defer**, not adopt — otherwise we'd be importing waterfall assurance ceremony into an alpha tool whose first tenet is that everything is disposable.

---

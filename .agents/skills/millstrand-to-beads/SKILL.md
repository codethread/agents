---
name: millstrand-to-beads
description: Migrate Millstrand kanban cards and nested tasks to native Beads, preserving descriptions and hierarchy. Use for a board import, a migration dry run, or checking a previous import—not ordinary Beads task management or live agent/workflow migration.
---

# Migrate a Millstrand board

Import work context, not executor state; preserve source history. Obtain authorization for the selected source and destination. Conversion does not authorize stopping the mill, clearing claims, replaying workflows, publishing, or removing the source.

## Capture and review

1. Read `strand --help`, `strand help kanban-export`, `beeswax skills get repository-setup`, and `br sync --help`. Confirm installed `br` supports **reviewed exact-ID additive reconciliation** (`--reconcile-additive`, `--expect-plan-sha256`). Never substitute destructive `--rebuild` or content-hash merging.
2. Use the repository's Node runtime and dependencies (`pnpm install --frozen-lockfile`). Resolve script paths from this skill directory. Run:

   ```sh
   node scripts/migrate.ts capture --workspace WORKSPACE --prefix PREFIX --owner HUMAN --output NEW_DIRECTORY
   ```

   `capture` reads the all-state board and full `kanban-export` subtrees, writing `source.json`, native `issues.jsonl`, and `report.json` without mutating either tracker. Output directories must not exist. **Do not convert `strand list` directly:** long bodies are replaced by omission objects.

3. Review card/task counts, status mapping, ID map, omitted nodes/edges, and limitations. Compare board membership and representative full bodies to the source. Capture is not transactional: arrange a quiet board window or repeat and compare before applying. The mill may keep running.
4. Read [mapping and review boundaries](references/mapping.md) before approving status or hierarchy changes. Consult [first-migration findings](../../../.hive/migrations/README.md) for Hive setup/import friction. Keep the raw capture as evidence; do not assume notes/comments or non-internal dependencies are complete.

For an offline replay, use a new destination:

```sh
node scripts/migrate.ts convert --source CAPTURE/source.json --prefix PREFIX --owner HUMAN --output NEW_DIRECTORY
```

Reuse one prefix per source workspace for repeat imports. IDs are `PREFIX-ms-STRAND_ID`, with `external_ref = millstrand:WORKSPACE:STRAND_ID`. Changing the prefix creates a different destination identity, not a rename.

## Rehearse, then apply

Initialize a disposable native tracker with `br init --prefix PREFIX`. Rehearse against its explicit database, export, and compare descriptions and relationships. Repeat the plan: unchanged input must yield zero creates/updates/conflicts and all rows equal. Run pure converter tests from the repository root with `pnpm exec vitest run .agents/skills/millstrand-to-beads/scripts/convert.test.ts`.

Initialize/adopt the real destination through **`beeswax setup`**, then inspect `beeswax beads env --json`. Preserve the supplied database and actor; read any active tracker alert before proceeding. Never use the rehearsal database for production. Before planning, verify canonical JSONL/base synchronization with the existing database using `br sync --status --db "$DB" --no-auto-import --no-auto-flush --json`. Resolve unrelated pending changes separately; retain the canonical JSONL/base and a consistent database backup outside the tracker.

With `DB` set to the reviewed database and `INPUT` to the absolute migration JSONL path:

```sh
BEADS_JSONL="$INPUT" br sync --db "$DB" --reconcile-additive \
  --allow-external-jsonl --no-auto-import --no-auto-flush --json > plan.json
```

Inspect exit status **and** receipt. Require `status: ready` or `no_changes`, no conflicts/deletes/new blocking cycles, and exactly the expected creates/updates. Preserve destination-only records. Retain the complete receipt outside the tracker.

After review, apply the exact token without intervening native reads/writes or input edits:

```sh
BEADS_JSONL="$INPUT" br sync --db "$DB" --reconcile-additive --apply \
  --expect-plan-sha256 "$(jq -r .plan_sha256 plan.json)" \
  --allow-external-jsonl --no-auto-import --no-auto-flush --json > applied.json
```

Use the scoped `BEADS_JSONL` override only for additive import, never publication or recovery. Do not export while it points at migration input. Native reads can update metadata and invalidate the token. If rejected, retain the failure, consult Hive recovery guidance, and obtain any required retry authorization. Never force a stale plan or continue dependent steps after an error.

## Verify and hand off

Require a successful apply receipt with no postcommit failures, then repeat the read-only plan to prove idempotency. Clear the per-command JSONL override. External additive reconciliation can certify the input hash and clear dirty markers without updating canonical JSONL, so a plain flush may refuse a misleading no-op. With the verified unchanged canonical JSONL/base, reconcile through native three-way merge:

```sh
br sync --merge --db "$DB" --no-auto-import --no-auto-flush --json
br sync --flush-only --db "$DB" --json
```

Require no conflicts, deletes, or unexpected changes. Do not use force flags or copy the migration input over an existing canonical snapshot. Compare the resulting export with input IDs, bodies, titles, statuses, priorities, labels, outcomes, owners, and every parent/blocking edge. Read a nested child with `br dep list ID --type parent-child --json` and fetch its ancestor description.

Record counts, exact mapping, omissions, and verification limits in the repository migration report. Commit the capture and reproducible tooling only when authorized. Keep the real tracker snapshot on `tracker/state`; publication requires separate authorization. Do not claim cutover complete until actual import, runtime delivery, and agreed worker activation are verified.

---
name: hive-to-botlake
disable-model-invocation: true
description: Capture and migrate Hive/Beads work into Botlake, with a reviewed dry run and optional authorized Hive removal.
---

# Migrate Hive work to Botlake

Separate work import from repository cutover. Confirm the selected source database, repository identity, destination lake, and whether the user wants work imported at all. A cleanup-only request skips capture and import; do not create destination tasks as a side effect.

## Capture selected Beads work

1. Read `br --help`, `br list --help`, `br show --help` and `br dep list --help`. Preserve supplied `BEADS_DB`, `BD_ACTOR` and explicit database selection. Confirm the source with `br where --json`; never let discovery choose an unrelated home tracker. Respect active source tracker holds.
2. Inventory all states, including deferred work, excluding automation records:

   ```sh
   br --no-auto-import --no-auto-flush list --all --deferred --exclude-label system --limit 0 --json
   ```

   Save the raw result in a new evidence directory. Use `--no-auto-import --no-auto-flush` on every source read to avoid automatic JSONL synchronization; stop if the installed CLI lacks these controls. Capture each selected record with `br show ID --json` and outgoing relationships with `br dep list ID --direction down --json`, retaining those global flags; confirm full descriptions, notes and acceptance context. Capture comments separately if in scope. Do not assume a summary list is a complete backup.

3. Follow each `parent-child` dependency through `depends_on_id` to the top-level parent, capturing ancestor descriptions and including or explicitly accounting for them. Deduplicate by exact issue ID. Record cross-scope prerequisites and excluded system/workflow endpoints; a missing prerequisite must not silently disappear into readiness.
4. Repeat inventory and compare record revisions/content after capture. Native reads are not a transactional snapshot. Resolve changing data before approval.
5. Review [source mapping](references/mapping.md), then follow [reviewed Botlake import](references/botlake-import.md). Use stable provenance `beads:REPOSITORY_ID:ISSUE_ID`; preserve existing external references as additional evidence. A dry run stops before destination writes.

## Cut over only when authorized

After verified import, or for an explicitly requested cleanup-only migration:

1. Read the target lake's setup documentation. Select the required extensions and shared configuration, install lake dependencies, start the lake and inspect its operations. Configuration does not prove managed agent execution.
2. Inventory tracked and ignored Hive assets before removal: `.hive`, BV recipes, Busy Bee workflows/workspace membership, installed Hive skills/receipts, Bee role adapters, harness onboarding/alert/identity hooks, Git snapshot validation hooks, merge attributes, environment overrides and documentation. Remove only Hive-owned content; preserve unrelated hooks, skills, pnpm checks, actor identity and human work.
3. Inspect Git worktrees, local/remote branches, Git config and ignored tracker paths. Preserve raw migration evidence outside anything being removed. Identify the exact tracker checkout and branch from source configuration rather than assuming `tracker/state`. Report dirty state, other users and active runtime custody before deleting anything.
4. Source service shutdown, worktree removal, local branch deletion and remote branch deletion need explicit authorization. Use the repository's worktree tooling while it remains active. A request to remove Hive files alone does not authorize deleting a remote branch or stopping a shared service. Do not remove global tools or configuration used by other repositories.
5. Update instructions and READMEs, remove dangling links/skill symlinks and unused dependency entries, and run the repository's checks. Verify a fresh harness process no longer loads Hive hooks. Report retained source data, running services and branches, plus any steps still awaiting authorization.

Do not announce full cutover solely because imports or files are complete. Verify actual lake startup and any agreed managed-agent smoke test separately; do not automatically reactivate legacy work.

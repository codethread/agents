# Millstrand-to-Beads migration skill

## Intent

Make repeatable, reviewable migrations of kanban work context into native Beads without carrying over Millstrand's runtime machinery. The first consuming request prioritized descriptions and nesting over comments, agent associations, and exact lifecycle equivalence.

The skill activates for migration, dry-run, and import verification work. Ordinary task pickup belongs to the Hive skill; executor/workflow migration is a separate design task.

## Design

- Capture full kanban subtrees rather than lean lists, which omit long bodies.
- Keep transformation pure and deterministic, with stable workspace-qualified provenance and IDs.
- Separate capture/conversion from native mutation. Require an inspectable exact-ID additive plan, a rehearsal, and post-import comparison.
- After external-file reconciliation, certify the unchanged canonical JSONL/base with native three-way merge. The first real import exposed that a zero-dirty-row flush can otherwise refuse the external source hash; never resolve that by overwriting an existing snapshot or forcing a stale plan.
- Preserve original status evidence without inventing live claims or implying abandoned work completed successfully.
- Keep the source and mapping report as audit material. Do not attempt runtime quiescence by stopping the mill.
- Use the existing Node/pnpm/Zod/Vitest stack, not a second package manager or ad hoc database writes.

## Validation tasks

1. Migrate a feature with a long body, nested task, and prerequisite. Success: full text survives unchanged; parent direction reverses; prerequisite direction does not.
2. Replay the same capture into a prepared tracker. Success: zero creates/updates/conflicts, with later destination-only work preserved.
3. Ask how to claim an existing bead. Near-miss: use Hive guidance, not this migration script.

Pure converter tests cover status precedence, omitted text rejection, outcomes, selected decision context, inherited priorities, overlapping exports, and invalid hierarchy. The first live rehearsal and migration findings are recorded in `.hive/migrations/README.md`.

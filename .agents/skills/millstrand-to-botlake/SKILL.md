---
name: millstrand-to-botlake
disable-model-invocation: true
description: Capture and migrate Millstrand kanban work into Botlake, with a reviewed dry run and import verification.
---

# Migrate Millstrand work to Botlake

Import selected work context, not executor state. Confirm the source workspace, destination lake and authorized scope. Keep the source intact; an import does not authorize stopping its mill, clearing claims, resuming workflows or publishing.

## Capture full work context

1. Read `strand --help`, `strand help kanban-export` and the installed help for `kanban board`. Capture the all-state board with `strand --workspace SOURCE kanban board --all true`.
2. For every selected card, capture `strand --workspace SOURCE kanban-export CARD_ID`. Save the raw board and full subtrees in a new evidence directory. **Do not convert lean `strand list` output:** long bodies can be omission objects. Reject omitted or non-string body text rather than importing placeholders.
3. Deduplicate identical nodes/edges from overlapping exports by source ID. Conflicting copies mean the source changed; capture again. Re-read board membership afterward and compare. For changing boards, arrange a quiet window or repeat captures; these reads are not an atomic snapshot.
4. Review [source mapping](references/mapping.md), then follow [reviewed Botlake import](references/botlake-import.md) for destination discovery, the plan, rehearsal, application and verification. A dry run ends at the approved plan without writing either system.

Keep standalone tasks outside card subtrees, cross-card prerequisites and comments explicit in the omissions report unless separately captured. Preserve one stable workspace-qualified identity, `millstrand:WORKSPACE:STRAND_ID`, per source item in the plan, journal and destination provenance.

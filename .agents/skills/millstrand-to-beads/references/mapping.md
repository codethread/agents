# Mapping and review boundaries

| Millstrand                                    | Beads                                                               | Review boundary                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Card/task ID                                  | Deterministic `PREFIX-ms-ID` and workspace-qualified `external_ref` | Use a distinct prefix for each source workspace.                                                                                 |
| Title and full `body`                         | Title and description, unchanged                                    | Missing/empty bodies omit description; native exact reconciliation rejects empty optional strings.                               |
| Epic / feature / task                         | Same issue type                                                     | Unknown types fail conversion.                                                                                                   |
| `parent-of` parent → child                    | Child dependency on parent, type `parent-child`                     | Reverse direction. Multiple parents and cycles fail for explicit review.                                                         |
| Internal `depends-on` task → prerequisite     | Same direction, type `blocks`                                       | Export only supplies edges internal to each subtree.                                                                             |
| `p1`…`p4`                                     | Numeric 1…4                                                         | Preserve the original scale; children inherit nearest explicit ancestor priority, otherwise 3. Do not silently upgrade p1 to P0. |
| Active pending / no lane                      | `open`, unassigned                                                  | Does not assert native readiness or authorize execution.                                                                         |
| Active claimed                                | `open`, unassigned; original lane in notes                          | A legacy agent claim is not a live Bee claim.                                                                                    |
| Active refinement                             | `draft`                                                             | Not ready for execution.                                                                                                         |
| Active in_review                              | `blocked`, `needs-human-review`                                     | Preserve the human decision requirement without inventing a human assignee.                                                      |
| Active in_production                          | `blocked`, `needs-release-validation`                               | Preserve unfinished release validation.                                                                                          |
| Closed / replaced                             | `closed`, original outcome in close reason/notes                    | Lifecycle wins over stale lanes. Abandoned/unactioned are not relabeled done.                                                    |
| UTC created/updated timestamps                | RFC3339 timestamps                                                  | Last update is only a proxy for closure time; disclose it.                                                                       |
| `kanban.label/* = true`                       | Labels plus `migrated:millstrand`                                   | Existing false labels are not enabled.                                                                                           |
| Source/design/blocker/decision/handoff fields | Selected historical context in notes                                | Raw capture retains other attributes; do not treat old commands as renewed authorization.                                        |
| Configured human owner                        | Bead owner                                                          | Separate from source agent ownership and assignee.                                                                               |

No comments, agent associations, run claims, workflow gates, processes, reviews-as-executions, or automatic landing actions are transferred. Generic descendants with `kind=task` are included; unrelated runtime descendants are reported as omitted. Standalone tasks outside every card subtree are outside this board import.

## Source completeness

`strand kanban board --all true` supplies both open and closed card IDs. `kanban-export` supplies full text and nesting; lean `list` substitutes objects such as `{"millstrand/omitted":true,"bytes":1201}` for long text. The converter rejects these rather than importing `[object Object]` or dropping prose.

Overlapping subtree exports deduplicate identical nodes and edges. If a shared node differs between reads, conversion fails. The capture also checks board membership before and after reading subtrees, but this is not an atomic snapshot. For a changing board, repeat captures and compare; do not stop its runtime without authorization.

Review external and cross-card prerequisites separately. If useful context exists only in comments, manually summarize the relevant decision into the destination after import; the bulk converter intentionally does not copy the discussion stream. Be explicit about remaining omissions rather than calling the result a full backup.

## Import identity and reruns

Use reviewed exact-ID additive reconciliation, not ordinary content-hash collision matching: different source tasks can have identical titles and bodies. A repeat of the same capture should be a no-op; the migration must not overwrite later Beads edits merely because the source still exists. Review every conflict/update before applying. Keep the source file immutable between planning and application, and avoid native commands that can update target metadata in that interval.

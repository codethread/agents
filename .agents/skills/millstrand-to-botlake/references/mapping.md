# Millstrand mapping

| Source                                                   | Botlake Work                      | Review boundary                                                                                                                     |
| -------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Epic/feature or node containing work                     | Group                             | Decide separately whether a container has executable scope needing a child task.                                                    |
| Executable leaf                                          | Task                              | Preserve original type in historical metadata.                                                                                      |
| Full title and body                                      | Title and description             | Retain original prose verbatim; reject lean omission objects.                                                                       |
| `parent-of` parent → child                               | `--parent` on the child           | Same direction; only groups can contain work.                                                                                       |
| `depends-on` dependent → prerequisite                    | `work link` with `depends-on`     | Same direction; exports may omit external edges. Group prerequisites do not propagate.                                              |
| Explicit `p1`…`p4`                                       | P1…P4                             | Inherit nearest explicit ancestor priority; use P3 if none, preserving the previous board import convention. Reject unknown values. |
| Active pending/no lane                                   | Open; AFK only after verification | Create HITL and unassigned during import.                                                                                           |
| Active claimed                                           | Open, unassigned                  | Preserve the original claim as history, never as live custody. Review before AFK.                                                   |
| Active refinement                                        | Open HITL                         | Record refinement requirement; Botlake has no draft state.                                                                          |
| Active in_review/in_production                           | Open HITL                         | Preserve human review or release-validation requirement without inventing a human assignment.                                       |
| Closed/replaced                                          | Closed where containment permits  | Source lifecycle wins over stale lanes. Record outcome; abandoned/replaced is not successful completion.                            |
| Labels, owner, timestamps, decisions and handoff context | Historical notes/metadata         | Not native labels, assignments or backdated lifecycle history.                                                                      |

Work records include kanban cards/tasks, feature/epic nodes and generic `kind=task` descendants. Report unrelated runtime descendants as excluded. Unknown node types, lanes, priorities, multiple parents, cycles and missing endpoints require an explicit mapping decision.

Comments, agent associations, run claims, workflow gates, processes and automatic landing actions are not transferred. Keep the raw attributes even when only selected decisions are summarized. Old commands and handoffs are historical context, not renewed execution authorization.

# Reviewed Botlake work import

Use this procedure after capturing the selected source. Import work context through Work operations, not SQLite writes or generic node mutations. An import is a sequence of commands, not an atomic transaction or a built-in reconciliation service.

## Plan without writing

1. Confirm the explicit destination with `botlake status` and `bl --workspace DEST help`. Read `bl --workspace DEST prime work`, then help for `work create`, `update`, `link`, `close`, `show`, `list`, and `criterion`. Preserve `BL_ACTOR`; source authors remain historical attribution, not the current caller.
2. Inventory destination work with `bl --workspace DEST --json work list --view all --state all --limit 100`. Follow `nextOffset` until null, then show candidate matches: lists omit full briefs. Preserve destination-only work.
3. Save an immutable capture and a reviewed plan outside either runtime database. Record a source identity qualified by workspace/repository, a capture hash, each source ID, proposed kind/title/full description/notes/priority/audience, relationships, and lifecycle evidence. Include every excluded item, unsupported field and unresolved decision. Title equality is not identity.
4. Map containers to groups and executable leaves to tasks. Only groups can be parents. If a source task also contains tasks, decide whether its own executable scope needs a separate child; do not silently convert that scope into inert context. Reject multiple contextual parents, containment cycles and unmapped endpoints. Review dependency cycles and group-prerequisite semantics: a group's prerequisites do not propagate to its members.
5. Preserve source-qualified provenance in task notes and in a clearly delimited group-description appendix. Keep original body text verbatim, including long text; retain source labels, timestamps, owners, outcomes and unsupported fields as historical metadata. Store the original body and any appendix separately in the plan, alongside the exact final destination description, so verification distinguishes preserved prose from added metadata. Native IDs, timestamps and assignment history are new. Work has no equivalent import flag for arbitrary IDs, labels, draft/blocked lanes, or legacy execution claims.
6. Keep new tasks HITL and unassigned during import. A later, separately reviewed update may set genuinely executable tasks to AFK. Draft, deferred, unresolved review/release and unexplained blocked work stay HITL with the reason recorded. Implement each non-prerequisite hold as task audience HITL plus a recorded reason; this excludes AFK availability but is not a separate readiness flag. Apply it to affected tasks, not just their groups. Preserve original human accountability in the record; assigning a human requires their explicit instruction.

Completion criterion: every selected item and edge is mapped or explicitly omitted, all topology/status decisions are resolved, and the user has approved the exact destination and plan. A dry run stops here.

## Rehearse and apply

Rehearse the approved plan in a disposable lake with Identity and Work selected. Use explicit workspace selection throughout. Compare the results below, then approve production separately; rehearsal IDs never become production IDs.

1. Create containing groups before their members. Create tasks with `--audience HITL` and no assignee. Supply full text through `bl --payload` or `--input @FILE` when shell quoting would be unsafe; read `bl --help` for attachment syntax. Persist each returned ID immediately in a source-to-destination journal, along with the command receipt and intended payload.
2. Once all endpoints exist, add prerequisites with `work link DEPENDENT PREREQUISITE --relation depends-on`. Use `--parent GROUP` at creation for containment; `work link` does not create parent relationships. Add non-blocking relationships only when their meaning is reviewed.
3. Preserve acceptance conditions. Task criteria are immutable once added: read criterion help, then add conditions and record explicit historical assessments before closing historical work. Keep group-level criteria in the group brief. Do not manufacture a successful assessment for abandoned or unresolved conditions.
4. Record outcomes in notes before closing historical tasks. Close groups from the leaves upward only after every contained task is closed. If the source has a closed container with open descendants, retain that inconsistency as evidence and resolve the mapping with the user instead of closing the descendants to satisfy Botlake.
5. Verify the complete import while tasks remain HITL. Only then apply the approved AFK changes. Leave unresolved holds HITL. Do not claim tasks, launch agents, replay workflows, or shut down source services as part of importing context.

Stop on the first failed command and retain receipts. A missing create receipt leaves uncertain state: inspect the destination using provenance before retrying. Never blindly replay creates. Resume from the journal; reuse known destination IDs, compare current records and relationships with the planned values, and review any later destination edits. A lost or ambiguous journal requires reconciliation, not title-based guessing or overwriting.

## Verify and hand off

Use `work show ID --history`, paged member reads and `work tree --state all --show-description --format json` to compare counts, full bodies, provenance, parents, prerequisites, priorities, audience, criteria and outcomes against the plan. Inspect representative ancestor context. Check `work list --view available` to ensure held work has not become executable. Do not infer successful completion merely from closed state.

Repeat the comparison with the same capture and journal: unchanged input should require no mutations. Report the exact mapping, capture hash, omissions, unresolved holds and evidence. Preserve raw captures and receipts outside disposable runtime storage. Source deletion, tracker-branch removal, service cutover, commits and pushes each require their own authorization; importing work does not grant them.

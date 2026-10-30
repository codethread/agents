# Codex session introspection

Help agents recover public user/assistant dialogue and audit tool activity from
read-only session evidence. Prefer the harness-owned stable log; disclose raw
schema recipes through a writer-version table when stable capture is incomplete
or the requested evidence exists only in raw rollouts.

Keep version-specific fields and queries in standalone references, preserving
older recipes for older sessions. Verify local writer metadata and representative
records before interpreting empty results. Separate spoken transcript segments
from written/promoted handoffs so voice intent is neither lost nor counted twice.
Keep private reasoning and unrelated protocol outside public dialogue exports.

The 0.165.0-alpha.1.2 reference records a locally observed `final_answer` phase and
realtime speech stream. Exact stable 0.165.0 writer compatibility remains
unverified. Skill metadata and discovery triggers are unchanged; this update adds
reference depth only after version selection.

---
description: Finish and archive a devflow feature
argument-hint: provide the feature name/folder and whether it shipped or was abandoned
disable-model-invocation: true
---

Load `plugins/devflow/skills/devflow/SKILL.md`.

Jump to the Finish / archive stage in the Devflow lifecycle. Use the Devflow skill's FINISH_ARCHIVE procedure. If the feature shipped, promote feature-local specs and deltas into canonical root specs, update `devflow/README.md`, mark feature-local deltas `Merged`, mark the plan `Shipped`, and move the feature folder to `devflow/archive/yy-mm-dd__<feat-name>/`. If the feature implemented one or more linked RFCs, move those RFC files from `devflow/rfcs/` into `devflow/archive/yy-mm-dd__<feat-name>/rfcs/`. If the feature was abandoned, do not promote unshipped contract changes unless explicitly requested; mark the plan `Abandoned` and archive the folder intact, including any RFCs that should retire with the abandoned feature.

User request:

$ARGUMENTS

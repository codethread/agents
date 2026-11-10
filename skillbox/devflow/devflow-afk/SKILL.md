---
name: devflow-afk
description: Prepare or explain running the devflow AFK loop for a feature
argument-hint: provide the feature name/folder and any extra context for the loop
disable-model-invocation: true
---

Load the `devflow` skill.

Jump to the AFK execution stage in the Devflow lifecycle. Use the Devflow skill to verify that the feature folder has `proposal.md`, a Reviewed or Active `<feat-name>.plan.md`, and `tasks/index.yml`, and that the task queue has runnable work. Do not implement tasks directly from this command. Instead, tell the user the exact `nushell` commands to load the `scripts/devflow` module from the loaded Devflow skill's directory (`use .agents/skills/devflow/scripts/devflow` for a Skillbox installation) and run `devflow all` for this feature, including any extra context they provided.

Use the arguments supplied with this skill invocation as the user’s request.

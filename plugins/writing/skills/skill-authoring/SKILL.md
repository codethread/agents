---
name: skill-authoring
description: >
  Create, revise, or review reusable agent skills and SKILL.md files. Use when
  turning a repeated workflow or domain practice into a skill, improving skill
  discovery or scope, reducing skill bloat, organizing supporting resources, or
  validating that a skill changes agent behavior as intended.
---

# Skill authoring

Write the smallest skill that reliably improves the agent's work. Ground it in real requests, project artifacts, user corrections, and observed failures—not generic knowledge the agent already has.

## Understand the job

Before drafting:

1. Inspect the target skill, its supporting files, callers, repository instructions, and nearby skills when they exist.
2. Identify one coherent capability, the requests that should activate it, the requests that should not, and the observable result of success.
3. Find the non-obvious knowledge, decisions, or repeated mechanics that a capable agent would otherwise miss.
4. Ask only for missing information that would materially change the skill. Otherwise, make a narrow, stated assumption and proceed.

Do not create a skill for a one-off answer, generic advice, or a project-wide convention that belongs in the repository's instruction file.

When revising a skill, preserve its name, invocation policy, supported metadata, and useful resources unless the requested change requires otherwise. Do not turn one failure or preference into a universal rule; generalize only from a real pattern.

## Design for discovery

The `name` and `description` are the routing surface. The body loads only after activation.

- Use a short, specific name made of lowercase letters, digits, and hyphens. Keep it at most 64 characters and match the folder name.
- Make the description say what the skill enables and when to use it, in terms that resemble user intent.
- Front-load the main capability and trigger context. Add exclusions only when they distinguish a likely near-miss.
- Keep procedural detail out of the description. It consumes discovery context and can become a misleading shortcut around the body.
- Keep the description at most 1,024 characters. Concision is more useful than enumerating every synonym.
- Use only frontmatter supported by the target hosts. Keep host-specific invocation or UI configuration in host-specific files when the format provides them.

## Choose the smallest useful shape

There is no required section taxonomy or document order. Match the structure and level of control to the task:

- **Reference:** state domain facts, conventions, or gotchas the agent cannot infer.
- **Linear workflow:** use numbered steps only when order matters.
- **Branched workflow:** include a basic ASCII flow showing the entry point, main decisions, and outcomes. Add a compact decision table or named states only when the flow needs supporting detail.
- **Tool-backed workflow:** define a script or tool interface when mechanics must be deterministic or are repeatedly reimplemented.

Keep the flow simple enough to scan at a glance:

```text
START
  |
  v
[condition?] -- yes --> [path A]
  |
  no
  v
[path B]
```

If the main workflow cannot be represented clearly with a basic ASCII flow, assume the skill is trying to do too much. Discuss narrowing its scope, splitting it into separate skills, extracting subworkflows, or simplifying its branches.

Use a Mermaid diagram only in the rare case that this discussion rejects those alternatives for concrete reasons and the skill still represents one coherent job. Load the `mermaid` skill before authoring the diagram.

Add prerequisites, examples, constraints, or validation only when they change execution. Knowledge, procedures, decisions, and checks are useful lenses—not mandatory headings.

Give the agent room to choose when several approaches are valid. Provide a clear default and a brief escape hatch. Be prescriptive when a sequence is fragile, consistency is essential, or side effects are risky. Explain the reason for important guidance; reserve `always` and `never` for genuine invariants.

## Spend context deliberately

Keep in `SKILL.md` only the purpose, core workflow, essential decisions, high-value gotchas, and constraints needed on most activations.

- Put substantial mode-specific detail, schemas, or example libraries in `references/`.
- Link every reference from `SKILL.md` and say exactly when to read it. Keep reference chains shallow.
- Put repeated deterministic work in `scripts/`; document inputs, outputs, dependencies, and failure behavior. Prefer running a tested helper over loading or recreating it.
- Put templates and files intended for generated output in `assets/`.
- Do not create placeholder directories or ancillary documentation without a concrete use.

Treat 300 lines or roughly 3,000 tokens as an upper bound for the body, not a target (code or diagrams are allowed to extend further as they are richer than pure prose). For every paragraph ask: “Would a capable agent likely make a worse decision without this?” Cut it if the answer is no; move it to a routed reference if it is only conditionally useful.

One small, realistic example is usually better than several repetitive ones. Examples should clarify a decision, interface, or output shape rather than substitute for the general rule.

## Write executable instructions

- Use direct, imperative language with explicit inputs, outputs, and observable conditions.
- State desired outcomes and decision criteria before prescribing mechanics.
- Preserve the user's chosen scope, product, and authorization boundaries. A skill teaches how to act; it does not grant permission for external or destructive actions.
- Write the skill as the literal message the agent will receive. Do not assume hidden orchestration state, a previous conversation, or knowledge of the script that invoked it.
- If another file, skill, or tool is required, identify it and say when and how to use it. Do not depend on resources that the target environment may not provide.
- Avoid generic background, motivational prose, duplicated summaries, speculative edge cases, and long catalogs of alternatives.

## Validate through behavior

For a new or substantially revised skill:

1. Define two or three realistic tasks and their success evidence. Include a likely near-miss when discovery boundaries matter.
2. Validate frontmatter, paths, referenced resources, and any scripts with the target host or repository tooling.
3. Run representative tasks in clean context when the skill is complex, risky, or hard to route. Compare with an unskilled baseline when the skill's value is unclear.
4. Review the full execution trace and produced artifacts, not just the final prose. Look for skipped instructions, wasted steps, false triggers, missing references, and repeated mechanics that should become a script.
5. Revise from observed evidence. Generalize the underlying issue, remove instructions that do not help, and repeat until further changes stop improving results.

Test outcomes and invariants, not exact wording, headings, or the presence of a checklist. Use automated assertions for objective properties and human review for subjective quality.

## Final review

Before finishing, verify that:

- the skill has one coherent job and a discriminating description;
- every instruction changes a likely decision or prevents a demonstrated mistake;
- optional detail is routed without hiding essential gotchas;
- every branched workflow has a simple ASCII flow, or documented reasons for the rare Mermaid exception after scope alternatives failed;
- specificity matches the fragility and risk of the task;
- constraints preserve user intent and do not invent authority;
- examples, scripts, and references are necessary, reachable, and consistent;
- validation checks observable behavior; and
- relevant repository documentation remains accurate.

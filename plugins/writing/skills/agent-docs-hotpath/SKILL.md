---
name: agent-docs-hotpath
description: Audit agent context and progressive disclosure when editing agent-facing instructions, skills or docs, or when asked what agents see during a session.
---

# Agent docs hotpath

Treat automatically loaded instructions and skill-discovery metadata as the hotpath: they cost context even when the task does not need them. Put task-specific detail behind explicit pointers that tell the agent when to read more.

## Establish what loads

Start with the repository's harness-loading reference, if one exists. For an ordinary edit, trace the affected loading path; inventory all supported harnesses only for a cross-harness audit. Recheck the map against configuration when that configuration changes or its accuracy is uncertain.

Identify the harness and launch directory, then inspect the relevant sources:

- **Instructions and rules:** for Claude, check `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` and `.claude/rules/`. For other harnesses, check `AGENTS.md` and configured alternatives. Account for ancestor instructions, nested instructions and path-scoped rules; these need not all load at startup. Verify the active harness's behavior rather than treating filenames as universal guarantees.
- **Harness configuration:** inspect relevant files under `.claude`, `.codex`, `.cursor`, `.pi` and other harness directories present in the repository, including ignored local configuration. Follow declarations of plugins, packages, hooks and extensions that contribute instructions or skills. For example, `.claude/settings.json` may enable plugins or context-producing hooks. A marketplace listing alone does not establish activation.
- **Skills:** check `.agents/skills`, Claude's `.claude/skills`, harness-specific roots and configured package roots. Verify discovery and invocation settings, including skills excluded from model discovery. Prefer symlinks into supported roots over duplicated skill collections when sharing skills across harnesses; check targets and coverage rather than assuming the collections match.

Distinguish **injected instructions**, **advertised skill metadata** and **loaded skill bodies**. Skill discovery normally exposes names and descriptions, often paths—not full instructions. Selection or explicit invocation loads the body. Hooks and extensions may inject context that is not an instruction file. Mark global or runtime-only contributions as unverified when they are outside the inspected scope; configuration evidence is not a runtime trace.

## Design progressive disclosure

Use this as a disclosure pattern, not a mandatory sequence:

```text
Startup instructions + skill metadata
  -> selected skill
  -> CLI help
  -> CLI-bundled instructions
  -> supporting references
```

Enter at the layer the task needs and load more only when its pointers apply. For CLI-backed work, use the command's actual help and bundled-instruction interface, such as `<cli> skills get <name>`, rather than assuming every CLI implements the same commands.

When editing agent-facing material, ask:

- Does every task need this content at its current layer, or should it be disclosed later?
- What would an agent miss if this moved off the hotpath? Keep essential constraints where the affected task will encounter them.
- Can the agent tell when to follow a pointer without opening its target? Name the trigger and a terse list of covered topics.
- Does the wording reuse repository terminology and any existing glossary so agents can find related guidance?

When designing or reviewing agent-facing CLI help and output, also use [agent-clis](../agent-clis/SKILL.md) for complementary interface and context-efficiency guidance.

## Keep a repository loading map

To avoid repeated harness discovery, discuss maintaining a repository-owned reference with the user before creating one. Reuse an existing map where possible. Record supported harnesses, automatic and conditional instruction sources, skill roots and symlinks, and plugin/package/hook/extension contributions. Link to authoritative configuration, note what was verified, and update the map when those sources change rather than copying their instructions into it.

Keep this map in the consuming repository, not in this portable skill. It should save repeated searches without becoming another unconditional context load.

## "Show me"

When asked what agents will see or read for a session or task, read [Show me](references/show-me.md) for reading-trigger maps, required versus possible loads, likelihood scores and context-cost reporting.

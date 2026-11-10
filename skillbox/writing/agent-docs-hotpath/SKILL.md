---
name: agent-docs-hotpath
description: Audit agent context and progressive disclosure when editing agent-facing instructions, skills or cli docs, or when asked what agents see during a session.
---

# Agent docs hotpath

The hotpath is what loads unasked: automatically injected instructions and advertised skill metadata. This skill establishes what each harness actually loads. For how to write and layer the material itself (context pointers, context load, progressive disclosure, pruning), use the `writing-for-agents` skill.

## Establish what loads

Start with the repository's loading map, if one exists, and recheck it against configuration when that configuration changes or its accuracy is uncertain. For an ordinary edit, trace the affected loading path; inventory all supported harnesses only for a cross-harness audit.

Identify the harness and launch directory, then inspect the relevant sources:

- **Instructions and rules:** for Claude, check `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` and `.claude/rules/`. For other harnesses, check `AGENTS.md` and configured alternatives. Account for ancestor instructions, nested instructions and path-scoped rules; these need not all load at startup. Verify the active harness's behavior rather than treating filenames as universal guarantees.
- **Harness configuration:** inspect relevant files under `.claude`, `.codex`, `.cursor`, `.pi` and other harness directories present in the repository, including ignored local configuration. Follow declarations of plugins, packages, hooks and extensions that contribute instructions or skills, such as plugins or context-producing hooks enabled in `.claude/settings.json`. A marketplace listing alone does not establish activation.
- **Skills:** check `.agents/skills`, Claude's `.claude/skills`, harness-specific roots and configured package roots. Verify discovery and invocation settings, including skills excluded from model discovery. Share skills across harnesses by symlinking into supported roots, and check targets and coverage rather than assuming the collections match.

Distinguish **injected instructions**, **advertised skill metadata** and **loaded skill bodies**. Skill discovery normally exposes names and descriptions, often paths; selection or explicit invocation loads the body. Hooks and extensions may inject context that is not an instruction file. Mark global or runtime-only contributions as unverified when they are outside the inspected scope; configuration evidence is not a runtime trace.

## Disclosure chain

```text
Startup instructions + skill metadata
  -> selected skill
  -> CLI help
  -> CLI-bundled instructions
  -> supporting references
```

Enter at the layer the task needs; the chain is a pattern, not a mandatory sequence. For CLI-backed work, use the command's actual help and bundled-instruction interface, such as `<cli> skills get <name>`, rather than assuming every CLI implements the same commands. For agent-facing CLI help and output design, use [agent-clis](../agent-clis/SKILL.md).

## Keep a repository loading map

Discuss a repository-owned loading map with the user before creating one; reuse an existing map where possible. Record supported harnesses, automatic and conditional instruction sources, skill roots and symlinks, and plugin/package/hook/extension contributions. Link to authoritative configuration and note what was verified rather than copying instructions into it. Keep the map in the consuming repository and off the hotpath.

## "Show me"

When asked what agents will see or read for a session or task, read [Show me](references/show-me.md) for reading-trigger maps, required versus possible loads, likelihood scores and context-cost reporting.

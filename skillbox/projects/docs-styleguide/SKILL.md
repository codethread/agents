---
name: docs-styleguide
description: Use when writing, updating or reviewing repository documentation, including READMEs, guides, AGENTS.md, CLAUDE.md and skills.
---

# Docs style guide

Write for the reader's current task: what they need to do, decide or understand to use the documented behavior correctly.

## Load the relevant guidance

Read the references for the document or section being edited; a mixed task may need more than one.

- **README or user guide:** read [User documentation](references/user-docs.md) for audience, placement and example-led explanation.
- **AGENTS.md, CLAUDE.md, skill or other agent-facing instructions:** read [Agent instructions](references/agent-instructions.md) for durable rules, task procedures and known-environment adaptations.
- **Workflow description:** read [Workflows](references/workflows.md) before choosing steps, ASCII or a diagram.

## Shared prose principles

- **Start with the task.** Organize around the reader's actions and decisions rather than the implementation history or the author's work. Keep depth where the task needs it; clarity is not a universal preference for short documents.
- **Use examples where they clarify.** When a command, configuration or payload conveys the contract more clearly, use it instead of repeated prose. Explain what the example cannot show: prerequisites, choices, consequences and constraints. Label illustrative examples; verify runnable examples against the supported interface.
- **State observable behavior.** Say what action changes which state, what the reader can observe and what they must do next. Replace opaque slogans with concrete semantics. Check wording for implied automation, guarantees or dependencies the system does not provide.
- **Write the supported path directly.** Establish the documented environment, then give its actual instructions. Keep alternatives and migration guidance when readers genuinely need them; otherwise remove obsolete branches and transition narration from the current procedure. Preserve required provenance in its appropriate home.
- **Use authoritative help.** Name a specific tool when it removes ambiguity; keep generic operations such as reading files generic when no particular tool matters. Point to the tool's maintained help or bundled guidance for mechanics, and supply the local purpose, choices and constraints rather than a second manual.
- **Edit for substance and cohesion.** Remove irrelevant sections and repeated explanations, not just words. Read the affected section and its references together so examples, instructions and caveats still agree. Let the repository's Markdown formatter govern wrapping; keep embedded-prose limits local to their stated scope.

## Ground guidance in the repository

Document tools and workflows the repository supports or requires, including external prerequisites. A tool being installed locally, preferred by the user or required by the harness does not make it a project requirement. Keep personal or harness-local machinery, such as lock wrappers and machine-specific paths, out of project guidance unless the repository explicitly adopts it.

For example, document `bun run test:changed` only if the repository defines that script. A user's test-lock wrapper is not thereby a repository requirement.

## Keep skill references within skills

Skills may reference other skills. Keep skill references out of repository documentation, including READMEs, guides, AGENTS.md and CLAUDE.md. Link those documents to ordinary repository documentation or authoritative tool help instead.

## Edit and review

1. Read the surrounding documentation, identify the reader's task and load the relevant guidance above.
2. Check the documented contract against repository sources or authoritative help; preserve essential commands, prerequisites and behavior.
3. Apply the prose principles to the whole affected section and its references.
4. Walk the result as the reader using the reference's acceptance checks. Verify documentation links and reachability of moved material. Report any examples or behavior you could not verify.

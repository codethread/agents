# agent-docs-hotpath

## Intent

Keep agent-facing documentation deliberate about what enters context, when it loads and what an agent might miss. Support routine editing and explicit reports of what agents see for a particular session or task. Optimize progressive disclosure, not merely document length.

## Design

The hotpath includes automatically loaded instructions and advertised skill metadata. Skill bodies, CLI help, CLI-bundled instructions and supporting references are progressively disclosed. This is a design pattern, not a mandatory traversal: some tasks need no CLI, and others start with a command.

Keep the discovery procedure in the skill body, including candidate instruction files, harness configuration, skill roots, symlinks and configured plugins/packages/hooks/extensions. These are inspection leads, not universal promises about harness behavior. Distinguish configured availability, advertised metadata and actual loading; keep runtime evidence separate from configuration-derived expectations.

Ordinary edits trace only the affected loading path. Cross-harness audits justify a full inventory. A consuming repository may maintain its own loading map to avoid repeated discovery; discuss that with the user before creating it. Such a map indexes authoritative configuration and verification limits rather than copying instructions or becoming unconditional context. This reusable skill does not prescribe the map's filename or embed this repository's harness configuration.

Keep the detailed Show me report format behind an explicit request trigger, with a terse topic list at the link. Reports cover non-file contributions as well as document reads and preserve evidence, likelihood-scoring and context-cost qualifications.

Link to agent-clis for complementary CLI interface design and focused output guidance; keep context-loading analysis distinct from CLI design.

## Validation

- An ordinary agent-document edit uses an existing loading map and traces the affected path without a full harness audit or loading the report reference.
- A cross-harness audit distinguishes Claude-specific instructions and scoped rules from other harness conventions, checks recognized skill roots and symlink coverage, and follows configured plugin or extension contributions. A marketplace listing alone does not prove activation.
- A request to show what agents see loads the reference and distinguishes automatic, conditional and optional context, skill metadata from bodies, parent from delegated context, and observed from unverified contributions.
- Without a repository map, the agent discusses maintaining one rather than creating it unprompted. The disclosure chain does not force CLI calls for document-only work.

Check local links and discovery metadata, and review representative scenarios for universal loading assumptions or unnecessary context expansion.

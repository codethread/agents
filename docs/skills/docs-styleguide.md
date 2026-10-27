# docs-styleguide

## Intent

Keep repository documentation aimed at the right audience and placed in the right file, grounded in what the repository actually supports. Keep workflow documentation legible at a glance.

## Design

Audience and placement rules separate user-facing READMEs and guides from agent-facing AGENTS.md files and skills. Skill references stay inside skills.

Workflow diagrams default to a short ASCII flow. A workflow too complex for one is treated as a scope signal: discuss narrowing or splitting the document before reaching for Mermaid, which is the rare exception and is authored with the `mermaid` skill. This guidance moved here from the retired `skill-authoring` skill, whose remaining guidance `writing-for-agents` covers.

## Validation

- A branched workflow gets a basic ASCII flow; a linear one gets numbered steps.
- A workflow that resists a simple ASCII flow prompts a scope discussion before any Mermaid diagram.
- Repository docs contain no skill references or personal harness machinery.

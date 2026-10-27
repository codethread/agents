# agent-clis

## Intent

Help agents design, implement and review CLIs around the caller's next decision. Preserve discoverable interfaces, focused default output, explicit expansion, honest collection bounds and actionable failure reporting.

## Design

The skill is portable across repositories. Repository CLI guidance and established command patterns take precedence; a bundled conventions reference supplies a starting point only for choices they leave open.

Keep broadly applicable design and verification guidance in the skill body. Keep concrete output conventions and the bundled-instructions command pattern in the reference so adopting the skill does not impose one repository's protocol or tooling. Maintainer rationale belongs here, outside the agent's operational instructions.

## Validation

- In a repository with documented output and instruction-discovery contracts, follow those contracts even when they differ from the reference.
- For a new CLI without conventions, use the reference to establish finite JSON responses and on-demand instruction discovery; read streaming guidance only when designing a stream.
- When reviewing one existing command, preserve its established contract and report unrelated inefficiencies separately.

Check local reference paths and keep the skill free of dependencies on the source repository's names or layout.

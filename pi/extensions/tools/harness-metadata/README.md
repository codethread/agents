# harness-metadata

Registers a `harness_metadata` tool that returns live Pi harness metadata for the current agent run.

The primary use case is giving the agent access to its current Pi session id when it needs to inspect or reference the persisted session.

Returned fields include:

- `sessionId`
- `sessionName`
- `sessionFile`
- `cwd`
- `model` (`provider`, `id`, `reasoning`, `contextWindow`, `usingSubscription`)
- `thinking`
- `contextUsage` (`tokens`, `percent`, `contextWindow`)

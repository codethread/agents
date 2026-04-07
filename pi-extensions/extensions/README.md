# Pi Extensions

This repository contains extensions for the Pi Coding Agent.

## Included Extensions

### `subagent`

Delegate tasks to specialized subagents with isolated context.

- **API/Contract:** Provides the `subagent` tool. Supports three execution modes:
  - **Single:** `{ agent, task, cwd }`
  - **Parallel:** `{ tasks: [{ agent, task, cwd }] }`
  - **Chain:** `{ chain: [{ agent, task, cwd }] }` (sequential, supports `{previous}` placeholder)

### `read-compact`

Reduce UI clutter when reading files.

- **API/Contract:** Replaces the default `read` tool with a version that renders truncated, compact output in the TUI.

### `bash-compact`

Reduce UI clutter when executing shell commands.

- **API/Contract:** Replaces the default `bash` tool with a version that renders compact execution summaries in the TUI.

### `claude-sync`

Synchronize Claude project context with Pi.

- **API/Contract:** Hooks into the `resources_discover` lifecycle event to automatically symlink Claude configuration/prompts to Pi equivalents on startup.

### `current-context-footer`

Persistent status display for workspace context.

- **API/Contract:** Uses `ctx.ui.setFooter()` to render current git branch, token usage, and active model status in the TUI.

### `copilot-questions`

Adds Copilot-specific autonomy guidance to the system prompt.

- **API/Contract:** On `before_agent_start`, if the active model provider is `github-copilot`, appends guidance telling the agent to investigate ambiguity proactively and use the `questionnaire` tool when clarification or new work is needed.

### `questionnaire`

Ask the user one or more structured questions through a custom TUI flow.

- **API/Contract:** Provides the `questionnaire` tool with `{ questions: [...] }` input. Supports single-question option lists, multi-question tab navigation, optional custom freeform answers via `allowOther`, and returns structured `details` containing normalized questions, collected answers, and cancellation state.

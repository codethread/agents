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

### `dynamic-agents-md`

Renders a repo-local `.pi/agent.njk` template into the system prompt, with access to model metadata and environment variables.

- **API/Contract:** Searches upward from `ctx.cwd` for the nearest `.pi/agent.njk`, `.pi/agent.md.njk`, or `.pi/agent.md`, renders it with [Nunjucks](https://mozilla.github.io/nunjucks/templating.html) using `{ provider, model, cwd, ...process.env }`, and appends the result to the system prompt.
- **Command:** Adds `/debug-prompt`, which writes the current effective system prompt to a temp file so it can be inspected or reused in another Pi instance.

### `questionnaire`

Ask the user one or more structured questions through an external-editor markdown form.

- **API/Contract:** Provides the `questionnaire` tool with `{ context?: string, questions: [...] }` input. The tool writes a temporary `.md` questionnaire, opens it in `$VISUAL` (fallback `$EDITOR`), parses `<user_response>` blocks after the editor exits, retries in-place with validation feedback when answers are invalid, and returns structured `details` containing normalized questions, collected answers, and cancellation state.

### `tldr`

Generate a user-only catch-up summary for the current session.

- **API/Contract:** Adds `/tldr`, which reads the current branch's user and assistant messages, strips tool-call and thinking blocks, sends the resulting transcript to a small available model, and shows the summary in transient UI without adding it to agent-visible session context.
- **Debug flags:** `--debug-tldr` prints the generated summary and exits. `--debug-tldr-transcript` prints the extracted transcript and exits.

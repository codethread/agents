# `owned-system-prompt`

> Own the complete Pi system prompt shape from structured Pi prompt inputs.

> [!NOTE]
> Runtime wiring lives in the merged [`system-prompt`](../README.md) extension entrypoint. This module exports pure prompt-building helpers for dependency injection and snapshot testing.

## What this module owns

`../index.ts` replaces `event.systemPrompt` during `before_agent_start` with output from this builder. It uses `event.systemPromptOptions` instead of scraping Pi's generated prompt, so the package controls ordering and formatting for:

- identity / custom prompt text
- project context files
- model-visible skills
- `--append-system-prompt` text
- current date and working directory
- selected tools from Pi's resolved tool set
- tool snippets and prompt guidelines exposed by Pi core/custom tools
- dynamic global/project rule template output

## Dependency injection

Use `createOwnedPromptBuilder({ wrapReminder })` to inject XML wrapping or test doubles. The default uses `wrapSystemReminder()` from `pi-extensions/shared/xml.ts`.

The renderer functions are intentionally pure:

- `renderOwnedTools()`
- `renderOwnedGuidelines()`
- `renderOwnedContextFiles()`
- `renderOwnedSkills()`
- `buildOwnedSystemPrompt()`

## Debugging

Use the merged `system-prompt` extension's `--debug-prompt` flag or `/debug-prompt` command to inspect the final materialized prompt.

Snapshot tests in `index.test.ts` show the exact prompt layout.

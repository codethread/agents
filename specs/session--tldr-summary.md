# Session TL;DR Summary Specification

**Status:** Implemented
**Last Updated:** 2026-04-08

## 1. Overview

### Purpose

The `tldr` extension generates a short user-facing catch-up summary for the current session branch without adding that summary back into agent-visible conversation context. It extracts a lightweight transcript from existing user/assistant messages, asks a small configured model to summarize it, then displays the result in transient UI or prints it for non-UI use.

### Goals

- Provide a fast way for the human user to catch up on the current branch.
- Keep summarization separate from the agent's working context.
- Prefer cheap/small models when available.
- Make transcript extraction robust against tool calls, thinking blocks, and malformed session data.
- Expose debug flags for transcript inspection and summary generation.

### Non-Goals

- Persisting summaries back into the session branch.
- Exposing summarization as a tool callable by the model.
- Summarizing non-current branches or the full session tree.
- Falling back to arbitrary models when preferred summary models are unavailable.
- Replaying tool results verbatim in the transcript.

## 2. Design Decisions

- **Decision:** Summaries are user-only and hidden from the agent.
  - **Rationale:** The command is for human catch-up, not for changing the agent's active context.

- **Decision:** Only preferred small models are used.
  - **Rationale:** TL;DR generation should be cheap and predictable rather than silently consuming a larger model.

- **Decision:** Transcript extraction ignores tool-call and thinking blocks.
  - **Rationale:** The summary should describe work status, not replay mechanics.

- **Decision:** Parsing uses defensive Zod validation with debug notes.
  - **Rationale:** Session and model payloads can vary; a best-effort path is more useful than hard failure on unexpected shapes.

- **Decision:** Debug flags run at session start and exit the process.
  - **Rationale:** They are inspection modes, not interactive session features.

## 3. Architecture

Implementation is split across:

- `pi-extensions/ui/tldr/`
- `pi-extensions/ui/tldr/summary.ts`

### Extension surface

The extension registers:

- flag: `--debug-tldr`
- flag: `--debug-tldr-transcript`
- command: `/tldr`
- lifecycle hook: `session_start`

No tools are registered.

### High-level flow

#### `/tldr` command

1. wait for the session to become idle with `ctx.waitForIdle()`
2. notify the user that TL;DR generation is starting
3. build a transcript from `ctx.sessionManager.getBranch()`
4. choose a preferred small model from currently available models
5. fetch auth via `ctx.modelRegistry.getApiKeyAndHeaders(model)`
6. call `complete(...)` with a fixed summarization prompt
7. parse assistant text from the completion response
8. render the summary in transient UI or print to stdout

If transcript extraction or summarization fails, the extension notifies the user instead of mutating session history.

#### Debug flags on `session_start`

When `--debug-tldr` or `--debug-tldr-transcript` is enabled, the extension runs a one-shot debug path on startup:

- extract the transcript immediately
- optionally summarize it
- print transcript and/or summary to stdout
- print parse notes to stderr when relevant
- exit with code `0` on success, `1` on failure

This path bypasses the interactive popup UI and is meant for inspection/testing.

### Transcript extraction model

`buildConversationTranscript(...)` walks the current branch and keeps only user/assistant text.

Included:

- branch entries with `type === "message"`
- roles `user` and `assistant`
- string content or `content[]` arrays containing text blocks

Ignored:

- non-message branch entries
- roles other than `user` and `assistant`
- `thinking`, `toolCall`, and `image` blocks in session entries
- empty text after trimming

Transcript format:

```text
User: ...

Assistant: ...
```

Malformed structures do not throw. They emit debug notes through an optional callback and are skipped.

### Summary model selection

`pickTldrModel(...)` uses a strict preference order:

1. `openai/gpt-5.4-nano` with thinking level `low`
2. `openai-codex/gpt-5.4-mini` with thinking level `low`

If neither is available, summarization is skipped and the user is warned.

### Completion request model

The extension builds a single user-message prompt using `buildTldrPrompt(transcript)`.

Prompt requirements include:

- keep the response under 50 lines
- use sections `## Goal`, `## Status`, `## Important context`, `## Next`
- focus on practical catch-up information
- ignore tool mechanics unless materially important

When the chosen model supports reasoning and the preferred thinking level is not `off`, the extension passes:

```ts
{
	reasoningEffort: thinkingLevel;
}
```

### Response parsing model

`extractSummaryFromResponse(...)` expects an assistant-like response shape and extracts only text content.

Ignored response block types:

- `thinking`
- `toolCall`

Behavioral details:

- missing or malformed structures produce debug notes instead of hard crashes
- `stopReason` and `errorMessage` are preserved when present
- unexpected response block types are reported through debug notes
- an empty extracted summary is treated as a warning condition, not a usable result

### UI presentation model

When UI is available, `/tldr` displays the summary in `ctx.ui.custom(...)` using:

- a bordered container
- title `TL;DR`
- a dim line showing which model was used
- markdown-rendered summary text
- a footer line: `Press Enter or Esc to close`

The UI explicitly notes that the summary is **hidden from agent**.

Without UI, the summary is printed to stdout.

## 4. Data Model

Main result type in `index.ts`:

```ts
type TldrResult = {
	transcript: string;
	summary: string;
	model: Model<any>;
};
```

Library types in `lib.ts`:

```ts
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type PreferredTldrModel<T extends ModelLike = ModelLike> = {
	model: T;
	thinkingLevel?: ThinkingLevel;
};

export type ResponseSummaryParseResult = {
	summary: string;
	stopReason?: string;
	errorMessage?: string;
	debug: string[];
};
```

Preferred-model constants:

```ts
const PREFERRED_SMALL_MODELS = [
	{ provider: "openai", id: "gpt-5.4-nano", thinkingLevel: "low" },
	{ provider: "openai-codex", id: "gpt-5.4-mini", thinkingLevel: "low" },
] as const;
```

## 5. Interfaces

### `/tldr` command contract

Success:

- extracts transcript from current branch
- summarizes it with a preferred small model
- shows transient UI or prints summary
- does not append the summary to agent-visible session context

Failure or skip conditions:

- empty transcript throws `No user/assistant text found in the current session.`
- unavailable preferred model warns and returns without summary
- missing auth for the chosen model warns and returns without summary
- unparsable/empty completion response warns and returns without summary

### `buildConversationTranscript(entries, options?)`

Behavioral contract:

- best-effort parsing only
- emits debug notes through `options.onDebug`
- returns `""` when no usable user/assistant text remains

### `pickTldrModel(available)`

Behavioral contract:

- returns the first preference-order match
- returns `undefined` when no preferred model exists
- does not rank arbitrary fallback models

### `extractSummaryFromResponse(response)`

Behavioral contract:

- returns `{ summary, stopReason, errorMessage, debug }`
- keeps parsing non-fatally when possible
- emits debug notes for malformed blocks and unexpected block types

## 6. Testing

Automated tests exist for library behavior in:

- `pi-extensions/ui/tldr/summary.test.ts`

Covered behaviors include:

- transcript extraction from mixed content
- string-based user content
- debug notes for malformed text blocks
- extraction of stop/error metadata from assistant responses
- detection of unexpected response block types
- preferred-model selection order
- undefined return when no preferred summary model is available

Interactive command/UI behavior in `index.ts` is still verified manually.

## 7. Open Questions

- Should the preferred-model list remain strict, or should there be an opt-in broader fallback policy?
- Should `/tldr` eventually support summarizing another branch or a bounded window of recent turns?
- Should the transcript builder start preserving more structured signals, such as explicit failure states, when they only appear outside assistant text?

## 8. Code Locations

- `pi-extensions/README.md`
- `pi-extensions/ui/tldr/`
- `pi-extensions/ui/tldr/summary.ts`
- `pi-extensions/ui/tldr/summary.test.ts`

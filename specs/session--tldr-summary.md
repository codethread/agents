# Session TL;DR Summary Specification

**Status:** Implemented
**Last Updated:** 2026-04-21

## 1. Overview

### Purpose

The `tldr` extension generates a short user-facing catch-up summary for the current session branch without adding it back into agent-visible conversation context. It extracts a lightweight transcript from existing user/assistant messages, asks a small configured model to summarize it, then displays the result in transient UI (or prints for non-UI use).

### Non-Goals

- Persisting summaries back into the session branch.
- Exposing summarization as a tool callable by the model.
- Summarizing non-current branches or the full session tree.
- Falling back to arbitrary models when preferred small models are unavailable.
- Replaying tool results verbatim in the transcript.

## 2. Design Decisions

- **Decision:** Summaries are user-only and hidden from the agent.
  - **Rationale:** The command is for human catch-up, not for changing the agent's active context.

- **Decision:** Only a strict preference list of small models is used (`openai/gpt-5.4-nano`, then `openai-codex/gpt-5.4-mini`, both at thinking level `low`).
  - **Rationale:** TL;DR should be cheap and predictable, not silently escalate to a larger model.

- **Decision:** Transcript extraction ignores `toolCall`, `thinking`, and `image` blocks; keeps only user/assistant text.
  - **Rationale:** The summary should describe work status, not replay mechanics.

- **Decision:** Parsing uses defensive Zod validation that emits debug notes instead of throwing.
  - **Rationale:** Session and model payloads vary; a best-effort path is more useful than hard failure on unexpected shapes.

- **Decision:** Debug flags (`--debug-tldr`, `--debug-tldr-transcript`) run at `session_start` and exit the process.
  - **Rationale:** They're inspection modes, not interactive features.

- **Decision:** The UI rendering explicitly labels the summary "hidden from agent".
  - **Rationale:** Makes the non-mutating contract visible to the user.

## 3. Summary Prompt Contract

The prompt instructs the model to:

- keep the response under 50 lines
- use sections `## Goal`, `## Status`, `## Important context`, `## Next`
- focus on practical catch-up info
- ignore tool mechanics unless materially important

When the chosen model supports reasoning and the preferred thinking level isn't `off`, the extension passes `reasoningEffort: <thinkingLevel>`.

## 4. Open Questions

- Should the preferred-model list stay strict, or support an opt-in broader fallback policy?
- Should `/tldr` eventually support summarizing another branch or a bounded recent-turns window?
- Should the transcript builder preserve structured signals (e.g. explicit failure states) that appear outside assistant text?

## 5. Code Locations

- `pi-extensions/ui/tldr/` — extension entry, command, debug flags, UI rendering
- `pi-extensions/ui/tldr/summary.ts` — transcript extraction, model selection, response parsing

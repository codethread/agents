# `dialogue-capture`

Pi counterpart of the Claude harness plugin's dialogue-capture hooks. Appends stable schema-v1 records — user prompts, final assistant replies, file touches, session end — to:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/pi-dialogue/<session-id>.jsonl
```

The schema is owned by this repo and shared with the Claude log (`claude-dialogue/` sibling directory); `plugins/harness/README.md` is the schema reference and jq cookbook. Downstream tooling (devflow Q&A extraction) should consume these logs, not raw session files.

## Event mapping

| Record        | Pi event             | Notes                                                                    |
| ------------- | -------------------- | ------------------------------------------------------------------------ |
| `prompt`      | `before_agent_start` | One per user prompt; `prompt_id` is a fresh UUID reused by later records |
| `reply`       | `agent_end`          | Text of the last assistant message only; mid-turn preamble is excluded   |
| `file`        | `tool_result`        | Successful `read`/`edit`/`write`, normalized to `Read`/`Edit`/`Write`    |
| `session_end` | `session_shutdown`   | `reason`: `quit`, `reload`, `new`, `resume`, `fork`                      |

Envelope fields match the Claude schema, including `model` (`provider/id`) and `thinking_level` from Pi's active model/thinking settings. `agent_type` is the `--agent <name>` the process runs as. Pi subagents are separate processes with their own sessions, so subagent records land in the subagent's own log file with `agent_id` set to that session id (`agent_id` null still means "main thread", as in the Claude log); parent↔child linking goes through the subagent session manifests.

## Divergences from the Claude capture

- `prompt` text is captured after skill/template expansion (Pi has no pre-expansion prompt event that fires in all modes); Claude logs the raw submission.
- Extension `/commands` never reach the agent, so they produce no `prompt` record.
- Subagent file touches live in the subagent's own log file, not the parent's.

## Debugging

- **Flag:** `--debug-dialogue-capture` — print the current session's log path and captured events, then exit.
- **Command:** `/debug-dialogue-capture` — same report in the shared debug panel (hidden from the agent; `Ctrl+Enter` sends it).

## Implementation layout

- `index.ts` — extension entrypoint; event wiring, JSONL writes, debug flag/command
- `capture.ts` — schema types and pure record-building/report helpers
- `capture.test.ts` — unit tests for the helpers

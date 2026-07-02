# Harness Plugin

Session and harness affordances for Claude Code and Pi: session introspection skills, benchmark orchestration, rich HTML responses, tmux workflows, and dialogue-capture hooks.

## Contents

- `commands/bench.md` — benchmark a task across models, prompts, or both
- `skills/claude-session-introspection/` — Claude Code `.jsonl` session forensics
- `skills/pi-session-introspection/` — Pi session forensics
- `skills/rich-response/` — render long-form responses as self-contained HTML
- `skills/tmux/` — durable terminal sessions for long-lived commands
- `hooks/` — dialogue-capture hooks (below)
- `hooks-reference.md` — vendored copy of the official Claude Code hooks reference

## Dialogue capture hooks

Claude Code's on-disk session transcripts are officially internal and can change on any release. These hooks capture the parts we care about through the supported hook interface at the moment they happen, into a JSONL log whose schema **we** own. Downstream tooling (devflow Q&A extraction, jq scripts) should consume this log, not the raw transcripts.

`hooks/capture.sh` listens to four events and appends one JSON object per line to:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/claude-dialogue/<session_id>.jsonl
```

### Schema (v1)

Every record shares an envelope. `agent_id` is the subagent discriminator: `null` on the main thread, set when the event fired inside a subagent. `agent_type` is the current agent's name — set for subagents **and** for top-level `claude --agent <name>` sessions — so don't use it to detect subagent traffic.

| Field        | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| `v`          | Schema version, `1`. Changes are additive only                    |
| `event`      | `prompt` \| `reply` \| `file` \| `session_end`                    |
| `ts`         | Capture time, ISO 8601 UTC                                        |
| `session_id` | Claude Code session id (also the filename)                        |
| `prompt_id`  | UUID of the user prompt being processed (null before v2.1.196)    |
| `cwd`        | Working directory when the event fired                            |
| `agent_id`   | Subagent id, or `null` outside subagents                          |
| `agent_type` | Agent name (e.g. `Explore`), also set on top-level `--agent` runs |

Per-event fields:

| `event`       | Source hook                                        | Extra fields                                                                                                        |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `prompt`      | `UserPromptSubmit`                                 | `text` — what the user submitted, before any expansion                                                              |
| `reply`       | `Stop`                                             | `text` — the assistant's final response text only (mid-turn preamble between tool calls is excluded by the harness) |
| `file`        | `PostToolUse` on `Read\|Edit\|Write\|NotebookEdit` | `tool`, `file_path`                                                                                                 |
| `session_end` | `SessionEnd`                                       | `reason` — `clear`, `resume`, `logout`, `prompt_input_exit`, …                                                      |

### Example queries

```bash
DLG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/claude-dialogue"
DLG="$DLG_DIR/<session-id>.jsonl"
# From inside a session, the agent's own log is:
DLG="$DLG_DIR/$CLAUDE_CODE_SESSION_ID.jsonl"

# Q&A transcript (main-thread dialogue). Stop-blocking hooks (e.g. /goal) make
# Stop fire more than once per prompt, so keep only the last reply per prompt_id.
jq -sr 'map(select(.agent_id==null)) |
  (map(select(.event=="reply")) | group_by(.prompt_id) | map(.[-1])) as $replies |
  (map(select(.event=="prompt")) + $replies) | sort_by(.ts) |
  .[] | "## \(.event) (\(.ts))\n\(.text)\n"' "$DLG"

# Files read anywhere (main agent + subagents)
jq -r 'select(.event=="file" and .tool=="Read") | .file_path' "$DLG" | sort -u

# Files modified, tagged by who touched them (agent_id null = main thread)
jq -r 'select(.event=="file" and .tool!="Read") |
  "\(.tool)\t\(if .agent_id then .agent_type else "main" end)\t\(.file_path)"' "$DLG" | sort -u

# Most recent session log for a project directory
rg -l --fixed-strings "\"cwd\":\"$PWD\"" "$DLG_DIR"/*.jsonl | xargs ls -t 2>/dev/null | head -1
```

### Caveats

- **Forward-only**: sessions run before the plugin (or with it disabled) have no log; fall back to the `claude-session-introspection` skill for those.
- `reply` records come from the `Stop` hook, which does not fire on user interrupts — an interrupted turn has a `prompt` with no matching `reply`.
- A Stop-blocking hook (e.g. a `/goal` condition) makes `Stop` fire once per attempted stop, so one `prompt` can have several `reply` records; only the last per `prompt_id` is the turn's final answer. Dedupe as in the Q&A query above.
- `prompt` text is the raw submission: slash commands appear as typed (e.g. `/goal ...`), not expanded.
- Subagent replies are not captured (only their `file` events); the dialogue is user ↔ main agent by design.
- The capture script never blocks a session: on any failure (missing `jq`, unwritable state dir) it exits 0 and drops the record.
- Cost/token accounting is out of scope; use `ccusage` (see the `claude-session-introspection` skill).

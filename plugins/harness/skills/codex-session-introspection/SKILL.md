---
name: codex-session-introspection
description: >
  Practical Codex session forensics quickstart. Use when the user wants to
  inspect Codex dialogue logs captured by this repo's harness Codex hooks,
  locate the current or recent Codex conversation, extract user/assistant
  dialogue, audit file/tool activity, or fall back to raw Codex rollout JSONL
  sessions when the stable dialogue log is missing.
---

# Codex Session Introspection

Operational notes and a small jq cookbook for inspecting Codex session history.

## Prefer the stable dialogue log

Codex sessions run with this repo's `harness` plugin enabled write a
stable, schema-v1 JSONL dialogue log to:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/codex-dialogue/<session-id>.jsonl
```

The writer is `plugins/harness/.codex-plugin/hooks/capture.sh`; the shared schema is
documented in `../../README.md`. Prefer this log for user/assistant dialogue and
file/tool activity. It excludes raw model protocol noise and is the format this
repo owns.

Use raw Codex rollout files only as a fallback:

```text
${CODEX_HOME:-$HOME/.config/codex}/sessions/YYYY/MM/DD/rollout-*.jsonl
```

## Variables

| Variable       | Value                                                  | Notes                                      |
| -------------- | ------------------------------------------------------ | ------------------------------------------ |
| `DLG_DIR`      | `${XDG_STATE_HOME:-$HOME/.local/state}/codex-dialogue` | Stable harness dialogue logs               |
| `DLG`          | `DLG_DIR/<session-id>.jsonl`                           | One JSONL file per Codex session id        |
| `CODEX_HOME`   | `${CODEX_HOME:-$HOME/.config/codex}`                   | Codex config/state root                    |
| `RAW_SESSIONS` | `${CODEX_HOME}/sessions`                               | Raw rollout JSONL fallback                 |
| `DEBUG_LOG`    | `DLG_DIR/debug/raw.jsonl`                              | Raw hook payloads when debug capture is on |

## Ground rules

- Never modify dialogue logs or raw session files.
- The dialogue log is append-only JSONL: one JSON object per line.
- `event` is one of `session_start`, `prompt`, `reply`, or `file`.
- `prompt` records contain the submitted user text in `.text`.
- `reply` records contain final assistant text in `.text` only when Codex
  includes final assistant text in the `Stop` hook payload.
- `file` records are emitted from `PostToolUse`; shell commands have `.command`
  and usually `file_path: null`.
- There is no Codex `SessionEnd` hook in the current capture script.
- Raw rollout files are Codex-internal protocol logs; their schema can drift.

## Finding sessions

```bash
DLG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/codex-dialogue"

# Current session when Codex exposes the id in the environment.
DLG="$DLG_DIR/$CODEX_SESSION_ID.jsonl"

# Most recent dialogue logs.
ls -t "$DLG_DIR"/*.jsonl 2>/dev/null | head -10

# Most recent log for the current working directory.
rg -l --fixed-strings "\"cwd\":\"$PWD\"" "$DLG_DIR"/*.jsonl |
  xargs ls -t 2>/dev/null | head -1

# Find a session by text seen in the UI.
rg -il --fixed-strings 'text from the message' "$DLG_DIR"/*.jsonl |
  xargs ls -t 2>/dev/null | head -1

# Confirm a hit by showing matching prompts.
DLG=<path-from-above>
jq -r 'select(.event=="prompt" and (.text | ascii_downcase | contains("text from the message"))) |
  "\(.ts)  \(.text[:160])"' "$DLG"
```

If `CODEX_SESSION_ID` is not set, locate the session by cwd or message text.
That is usually more reliable than guessing from timestamps.

## Conversation extraction

```bash
# User prompts only.
jq -r 'select(.event=="prompt") | "## prompt (\(.ts))\n\(.text)\n"' "$DLG"

# Assistant final replies only.
jq -r 'select(.event=="reply") | "## reply (\(.ts))\n\(.text)\n"' "$DLG"

# Q&A transcript. If several reply records exist for one prompt_id, keep the last.
jq -sr 'map(select(.agent_id==null)) |
  (map(select(.event=="reply")) | group_by(.prompt_id) | map(.[-1])) as $replies |
  (map(select(.event=="prompt")) + $replies) | sort_by(.ts) |
  .[] | "## \(.event) (\(.ts))\n\(.text)\n"' "$DLG"

# Chronological compact transcript.
jq -r 'select(.event=="prompt" or .event=="reply") |
  "[\(.event)] \(.text[:200])"' "$DLG"
```

An interrupted turn can have a `prompt` with no matching `reply`; this is
expected because `Stop` may not fire on interrupt.

## Tool and file activity

```bash
# Tool/file event counts.
jq -r 'select(.event=="file") | .tool // "unknown"' "$DLG" |
  sort | uniq -c | sort -rn

# Shell commands captured from tool events.
jq -r 'select(.event=="file" and .command != null) |
  "\(.ts)\t\(.command)"' "$DLG"

# Files read or touched when the hook payload includes a path.
jq -r 'select(.event=="file" and .file_path != null) |
  "\(.tool)\t\(.file_path)"' "$DLG" | sort -u

# Events grouped by prompt id for one turn.
PID=<prompt-id>
jq -r --arg pid "$PID" 'select(.prompt_id==$pid) |
  if .event=="file" then "[file] \(.tool) \(.file_path // .command // "")"
  else "[\(.event)] \(.text // "")"
  end' "$DLG"
```

## Debugging capture

```bash
# Launch a fresh Codex process with raw hook payload capture enabled.
CODEX_DIALOGUE_CAPTURE_DEBUG=1 codex

# Inspect raw hook payloads.
jq -c '.' "${XDG_STATE_HOME:-$HOME/.local/state}/codex-dialogue/debug/raw.jsonl" | tail -20
```

Debug payloads are useful when a field is missing from the stable log. The hook
intentionally drops unsupported fields instead of blocking Codex.

## Raw Codex rollout fallback

Prefer the dialogue log above. Use raw rollout files only for questions the
dialogue log cannot answer, or for sessions that ran without the `harness` plugin's Codex hooks.

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.config/codex}"

# Recent raw sessions.
find "$CODEX_HOME/sessions" -type f -name 'rollout-*.jsonl' -print |
  xargs ls -t 2>/dev/null | head -10

# Find raw session by message text.
rg -il --fixed-strings 'text from the message' "$CODEX_HOME/sessions" |
  xargs ls -t 2>/dev/null | head -1

# Basic raw session summary.
RAW=<path-from-above>
jq -sr '{
  session_id: (map(select(.type=="session_meta"))[0].payload.session_id),
  cwd: (map(select(.type=="session_meta"))[0].payload.cwd),
  entries: length,
  user_messages: [ .[] | select(.type=="event_msg" and .payload.type=="user_message") ] | length,
  assistant_messages: [ .[] | select(.type=="event_msg" and .payload.type=="agent_message") ] | length
}' "$RAW"

# Raw user messages.
jq -r 'select(.type=="event_msg" and .payload.type=="user_message") |
  "\(.timestamp)  \(.payload.message)"' "$RAW"

# Raw assistant messages visible in the UI.
jq -r 'select(.type=="event_msg" and .payload.type=="agent_message") |
  "\(.timestamp)  \(.payload.message)"' "$RAW"

# Raw function/tool call names.
jq -r 'select(.type=="response_item" and .payload.type=="function_call") |
  .payload.name' "$RAW" | sort | uniq -c | sort -rn
```

Raw rollout files include internal protocol records (`response_item`, `event_msg`,
reasoning blobs, tool call outputs, token counts, and session metadata). Re-check
the shape with `jq -r '.type' "$RAW" | sort | uniq -c` before writing new raw
parsers.

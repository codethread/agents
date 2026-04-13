---
name: pi-session-introspection
description: >
  Cookbook for introspecting Pi agent and subagent session files using jq.
  Use when the user wants to understand what happened in a Pi session, review
  agent behavior, audit tool usage, inspect thinking patterns, check costs,
  or debug subagent orchestration. Triggers on phrases like "what did the agent do",
  "show me the session", "how many edits", "what tools were used", "review session",
  "session analysis", "agent audit", or any request to parse/inspect .jsonl session files.
---

# Pi Session Introspection

jq cookbook for fast, repeatable analysis of Pi agent and subagent session JSONL files.

## Variables

| Variable             | Value                                                               | Notes                                      |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| SESSION_DIR          | `~/.pi/agent/sessions/`                                             | Parent agent sessions                      |
| SUBAGENT_SESSION_DIR | `~/.pi/agent/subagent-sessions/`                                    | Subagent session storage                   |
| CWD_ENCODING         | Strip leading `/`, replace `/` with `-`, wrap with `--`             | Used in directory names                    |
| SESSION_GLOB         | `SESSION_DIR/--<CWD_ENCODING>--/*.jsonl`                            | All sessions for a given working directory |
| SUBAGENT_MANIFEST    | `SUBAGENT_SESSION_DIR/--<CWD_ENCODING>--/<parent-id>/manifest.json` | Subagent run index per parent              |

## Prerequisites

- `jq` is available on PATH
- Target session file exists and is a valid JSONL file
- For subagent analysis: a `manifest.json` exists in the subagent session directory

## Knowledge

### Session file format

Files are JSONL (one JSON object per line). First line is always a header:

```json
{ "type": "session", "version": 3, "id": "<uuid>", "timestamp": "...", "cwd": "..." }
```

All subsequent lines are entries with `type`, `id`, `parentId`, `timestamp`. The primary entry type is `"message"` which wraps an `AgentMessage` in `.message`.

### Message roles

| Role         | Found at   | Key fields                                                                      |
| ------------ | ---------- | ------------------------------------------------------------------------------- |
| `user`       | `.message` | `.content` (string or content-block array)                                      |
| `assistant`  | `.message` | `.content[]` (text/thinking/toolCall blocks), `.usage`, `.model`, `.stopReason` |
| `toolResult` | `.message` | `.toolName`, `.toolCallId`, `.content[]`, `.isError`, `.details`                |

### Assistant content block types

| `.type`    | Key fields                            |
| ---------- | ------------------------------------- |
| `text`     | `.text`                               |
| `thinking` | `.thinking`                           |
| `toolCall` | `.name`, `.id`, `.arguments` (object) |

### Other entry types

`model_change` (`.provider`, `.modelId`), `thinking_level_change` (`.thinkingLevel`), `compaction` (`.summary`, `.tokensBefore`, `.firstKeptEntryId`), `branch_summary` (`.summary`, `.fromId`), `custom` (`.customType`, `.data`), `custom_message` (`.customType`, `.content`, `.display`), `label` (`.targetId`, `.label`), `session_info` (`.name`).

### Usage structure (on assistant messages)

```
.message.usage.input          # input tokens
.message.usage.output         # output tokens
.message.usage.cacheRead      # cached input tokens
.message.usage.cacheWrite     # tokens written to cache
.message.usage.totalTokens    # context window consumption
.message.usage.cost.total     # USD cost for this turn
```

### Subagent manifest shape

When a parent session is persisted, each subagent run gets its own `.jsonl` in a per-parent directory, indexed by `manifest.json`:

```
SUBAGENT_SESSION_DIR/--<CWD_ENCODING>--/<parent-session-id>/
  manifest.json
  <uuid>.jsonl      # each is a full session file — all recipes below work on these
```

Manifest entry fields: `id`, `agent`, `agentSource`, `description`, `prompt`, `sessionFile`, `timestamp`, `exitCode`, `usage.{input,output,cost}`, `durationMs`, `provider`, `model`, `thinking`.

### Tree structure caveat

Entries form a tree via `id`/`parentId`. Branched sessions may have entries unreachable from the current leaf. For linear analysis the recipes below work as-is. For branched sessions, trace backwards from the last entry through `parentId` to reconstruct the active branch.

## Procedures

All recipes assume `$SESSION` is set to the path of a `.jsonl` file.

### Finding sessions

```bash
# List sessions for current directory (most recent first)
S=~/.pi/agent/sessions/--$(pwd | sed 's|^/||;s|/|-|g')--
ls -lt "$S"/*.jsonl 2>/dev/null | head -10

# Most recent session
SESSION=$(ls -t "$S"/*.jsonl 2>/dev/null | head -1)

# Find session by name (from session_info entries)
for f in "$S"/*.jsonl; do
  name=$(jq -r 'select(.type == "session_info") | .name' "$f" 2>/dev/null | tail -1)
  [ -n "$name" ] && echo "$name → $f"
done

# Session header info
head -1 "$SESSION" | jq '{id: .id, cwd: .cwd, time: .timestamp}'
```

### Conversation overview

```bash
# Entry type counts
jq -r '.type' "$SESSION" | sort | uniq -c | sort -rn

# Message role counts
jq -r 'select(.type == "message") | .message.role' "$SESSION" | sort | uniq -c | sort -rn

# Chronological role sequence
jq -r 'select(.type == "message") | .message.role' "$SESSION"
```

### User messages

```bash
# All user messages (text only)
jq -r 'select(.type == "message" and .message.role == "user") |
  .message.content |
  if type == "string" then .
  else [.[] | select(.type == "text") | .text] | join("\n")
  end' "$SESSION"

# User messages with timestamps
jq -r 'select(.type == "message" and .message.role == "user") |
  "\(.timestamp) | \(
    .message.content |
    if type == "string" then .[:120]
    else [.[] | select(.type == "text") | .text[:120]] | join(" ")
    end
  )"' "$SESSION"
```

### Assistant text output

```bash
# All assistant text responses (excludes thinking and tool calls)
jq -r 'select(.type == "message" and .message.role == "assistant") |
  [.message.content[] | select(.type == "text") | .text] |
  join("\n") | select(length > 0)' "$SESSION"

# Assistant responses with model and stop reason
jq -r 'select(.type == "message" and .message.role == "assistant") |
  "\(.message.model) [\(.message.stopReason)] \(
    [.message.content[] | select(.type == "text") | .text[:100]] | join(" ")
  )"' "$SESSION"
```

### Tool usage analysis

```bash
# Tool call counts (most used first)
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall") | .name' "$SESSION" |
  sort | uniq -c | sort -rn

# Tool call timeline (invocation order)
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall") | .name' "$SESSION"

# Tool results with error counts
jq -r 'select(.type == "message" and .message.role == "toolResult") |
  "\(.message.toolName)\(if .message.isError then " ❌" else "" end)"' "$SESSION" |
  sort | uniq -c | sort -rn

# Failed tool calls only (with error text preview)
jq -c 'select(.type == "message" and .message.role == "toolResult" and .message.isError == true) |
  {tool: .message.toolName,
   content: ([.message.content[] | select(.type == "text") | .text[:200]] | join(" "))}' "$SESSION"
```

### File operations

```bash
# All read files (with read count)
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall" and .name == "read") |
  .arguments.path' "$SESSION" | sort | uniq -c | sort -rn

# All edited files (with edit count)
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall" and .name == "edit") |
  .arguments.path' "$SESSION" | sort | uniq -c | sort -rn

# All written files (with write count)
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall" and .name == "write") |
  .arguments.path' "$SESSION" | sort | uniq -c | sort -rn

# Total edit call count
jq '[select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall" and .name == "edit")] |
  length' "$SESSION"

# Edit complexity: number of edits[] entries per edit call
jq 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall" and .name == "edit") |
  {path: .arguments.path, edits: (.arguments.edits | length)}' "$SESSION"

# All files touched (read/edit/write) — deduplicated
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] |
  select(.type == "toolCall" and (.name == "read" or .name == "edit" or .name == "write")) |
  .arguments.path' "$SESSION" | sort -u
```

### Bash commands

```bash
# All bash commands executed
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall" and .name == "bash") |
  .arguments.command' "$SESSION"

# Bash commands with truncated output preview
jq -r 'select(.type == "message" and .message.role == "toolResult" and .message.toolName == "bash") |
  [.message.content[] | select(.type == "text") | .text[:150]] | join(" ")' "$SESSION"
```

### Thinking / reasoning

```bash
# All thinking blocks (full text)
jq -r 'select(.type == "message" and .message.role == "assistant") |
  [.message.content[] | select(.type == "thinking") | .thinking] |
  join("\n---\n") | select(length > 0)' "$SESSION"

# Thinking block stats (count, avg length, total chars)
jq -s '[.[] |
  select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "thinking") | .thinking | length] |
  {count: length,
   avg_chars: ((. | add) / (. | length) | floor),
   total_chars: (. | add)}' "$SESSION"

# Thinking-to-action: show thinking excerpt then immediate tool calls in same turn
jq -r 'select(.type == "message" and .message.role == "assistant") |
  {thinking: ([.message.content[] | select(.type == "thinking") | .thinking[:200]] | join(" ")),
   tools: [.message.content[] | select(.type == "toolCall") | .name]} |
  select(.thinking | length > 0) |
  "THINK: \(.thinking)\nTOOLS: \(.tools | join(", "))\n---"' "$SESSION"

# Turns where thinking produced no tool use (pure text response after reasoning)
jq -r 'select(.type == "message" and .message.role == "assistant") |
  select([.message.content[] | select(.type == "thinking")] | length > 0) |
  select([.message.content[] | select(.type == "toolCall")] | length == 0) |
  [.message.content[] | select(.type == "text") | .text[:200]] | join(" ")' "$SESSION"
```

### Token usage and cost

```bash
# Total cost and turn count
jq -s '[.[] | select(.type == "message" and .message.role == "assistant") |
  .message.usage.cost.total] |
  {total_cost_usd: add, turns: length}' "$SESSION"

# Per-turn token usage
jq -r 'select(.type == "message" and .message.role == "assistant") |
  "\(.message.usage.input)in \(.message.usage.output)out $\(.message.usage.cost.total | tostring[:6]) \(.message.model)"' "$SESSION"

# Context growth over time (totalTokens per assistant turn)
jq 'select(.type == "message" and .message.role == "assistant") |
  .message.usage.totalTokens' "$SESSION"

# Most expensive single turn
jq -s '[.[] | select(.type == "message" and .message.role == "assistant")] |
  sort_by(.message.usage.cost.total) | last |
  {cost: .message.usage.cost.total,
   tokens: .message.usage.totalTokens,
   tools: [.message.content[] | select(.type == "toolCall") | .name]}' "$SESSION"

# Cache efficiency
jq -s '[.[] | select(.type == "message" and .message.role == "assistant") | .message.usage] |
  {total_input: (map(.input) | add),
   total_cache_read: (map(.cacheRead) | add),
   cache_ratio: ((map(.cacheRead) | add) / (map(.input) | add) * 100 | floor | tostring + "%")}' "$SESSION"
```

### Model and config changes

```bash
# Model changes during session
jq -r 'select(.type == "model_change") |
  "\(.timestamp) → \(.provider)/\(.modelId)"' "$SESSION"

# Thinking level changes
jq -r 'select(.type == "thinking_level_change") |
  "\(.timestamp) → \(.thinkingLevel)"' "$SESSION"
```

### Subagent analysis

```bash
# Find subagent sessions for a parent session
PARENT_ID=$(head -1 "$SESSION" | jq -r '.id')
PARENT_CWD=$(head -1 "$SESSION" | jq -r '.cwd')
SUBAGENT_DIR=~/.pi/agent/subagent-sessions/--$(echo "$PARENT_CWD" | sed 's|^/||;s|/|-|g')--/$PARENT_ID

# List all subagent runs from manifest
jq -r '.subagents[] |
  "\(.agent) [\(.agentSource)] \(.description) — exit:\(.exitCode) \(.durationMs)ms $\(.usage.cost)"' \
  "$SUBAGENT_DIR/manifest.json" 2>/dev/null

# Subagent cost and duration summary
jq '{total_cost: [.subagents[].usage.cost] | add,
     total_duration_ms: [.subagents[].durationMs] | add,
     count: (.subagents | length),
     by_agent: [.subagents | group_by(.agent)[] |
       {agent: .[0].agent, count: length, cost: [.[].usage.cost] | add}]}' \
  "$SUBAGENT_DIR/manifest.json" 2>/dev/null

# Failed subagents
jq '.subagents[] | select(.exitCode != 0) |
  {agent, description, exitCode, prompt: .prompt[:200]}' \
  "$SUBAGENT_DIR/manifest.json" 2>/dev/null

# Introspect a specific subagent session (all recipes above work on these files)
# SUBSESSION="$SUBAGENT_DIR/<uuid>.jsonl"

# Tool usage across all subagent runs
for f in "$SUBAGENT_DIR"/*.jsonl; do
  echo "=== $(basename "$f") ==="
  jq -r 'select(.type == "message" and .message.role == "assistant") |
    .message.content[] | select(.type == "toolCall") | .name' "$f" |
    sort | uniq -c | sort -rn
done
```

### Compaction and branching

```bash
# Compaction events
jq 'select(.type == "compaction") |
  {timestamp, tokensBefore: .tokensBefore, summary: .summary[:200]}' "$SESSION"

# Branch summaries
jq 'select(.type == "branch_summary") |
  {timestamp, fromId, summary: .summary[:200]}' "$SESSION"
```

### Full session dashboard

```bash
jq -s '
  (.[0] | {session_id: .id, cwd: .cwd, started: .timestamp}) +
  {
    messages: [.[] | select(.type == "message")] | length,
    user_msgs: [.[] | select(.type == "message" and .message.role == "user")] | length,
    assistant_turns: [.[] | select(.type == "message" and .message.role == "assistant")] | length,
    tool_calls: [.[] | select(.type == "message" and .message.role == "assistant") |
      .message.content[] | select(.type == "toolCall")] | length,
    tools: ([.[] | select(.type == "message" and .message.role == "assistant") |
      .message.content[] | select(.type == "toolCall") | .name] |
      group_by(.) | map({(.[0]): length}) | add),
    errors: [.[] | select(.type == "message" and .message.role == "toolResult" and .message.isError == true)] | length,
    total_cost: ([.[] | select(.type == "message" and .message.role == "assistant") |
      .message.usage.cost.total] | add),
    thinking_blocks: [.[] | select(.type == "message" and .message.role == "assistant") |
      .message.content[] | select(.type == "thinking")] | length,
    compactions: [.[] | select(.type == "compaction")] | length,
    files_edited: ([.[] | select(.type == "message" and .message.role == "assistant") |
      .message.content[] | select(.type == "toolCall" and .name == "edit") | .arguments.path] | unique | length),
    files_read: ([.[] | select(.type == "message" and .message.role == "assistant") |
      .message.content[] | select(.type == "toolCall" and .name == "read") | .arguments.path] | unique | length)
  }
' "$SESSION"
```

## Constraints

- Never modify session files — they are append-only.
- Entry IDs are 8-char hex strings; session IDs are UUIDs — do not confuse them.
- The first line (`type: "session"`) is the header, not a message. Skip it for message analysis or account for it when using `jq -s` (slurp).
- `jq -s` loads the entire file into memory. For very large sessions, prefer streaming `jq` (without `-s`) where possible.
- Subagent `.jsonl` files follow the exact same format as parent sessions — all recipes work on them without modification.
- When analysing branched sessions, not all entries may be on the active branch. For accurate branch-specific analysis, trace from the final entry backwards through `parentId`.

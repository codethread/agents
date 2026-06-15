---
name: pi-session-introspection
description: >
  Practical Pi session forensics quickstart. Use when the user wants to inspect
  Pi .jsonl session files, locate recent sessions, extract conversation text,
  audit tool usage, check costs, or debug this repo's subagent-session manifests.
  Defers to official Pi docs for authoritative session schema and lifecycle.
---

# Pi Session Introspection

Operational notes and a small jq cookbook for inspecting Pi session files.

This skill is **not** the source of truth for Pi's session schema. For canonical
format and lifecycle details, first consult the bundled Pi docs:

- `~/.pi/pi-source/docs/sessions.md`
- `~/.pi/pi-source/docs/session-format.md`
- `~/.pi/pi-source/docs/compaction.md`

Use this skill for the pieces the docs do not optimize for: quickly finding local
session files, avoiding common jq mistakes, and inspecting this repo's subagent
session manifests.

## Variables

| Variable               | Value                                                               | Notes                                  |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `SESSION_DIR`          | `~/.pi/agent/sessions/`                                             | Parent agent sessions                  |
| `SUBAGENT_SESSION_DIR` | `~/.pi/agent/subagent-sessions/`                                    | This repo's subagent extension storage |
| `CWD_ENCODING`         | Strip leading `/`, replace `/` with `-`, wrap with `--`             | Used in directory names                |
| `SESSION_GLOB`         | `SESSION_DIR/--<CWD_ENCODING>--/*.jsonl`                            | Sessions for a cwd                     |
| `SUBAGENT_MANIFEST`    | `SUBAGENT_SESSION_DIR/--<CWD_ENCODING>--/<parent-id>/manifest.json` | Subagent run index per parent          |

## Ground rules

- Never modify session files. Treat JSONL sessions as append-only history.
- The first line is the session header, not a tree entry.
- Session entries form a tree via `id` / `parentId`; whole-file jq includes abandoned branches.
- For active-branch analysis, trace backward from the current leaf through `parentId`.
- `.message.content` is not uniform:
  - user content can be a string or content-block array
  - assistant content is an array of text/thinking/toolCall blocks
  - tool results are content-block arrays
- `custom` entries are extension state and do **not** enter LLM context.
- `custom_message` entries are extension-injected context and **do** enter LLM context.
- Subagent `.jsonl` files use the normal Pi session format; the subagent-specific bit is the manifest path and metadata.

## Finding sessions

```bash
# Sessions for the current directory, newest first
S=~/.pi/agent/sessions/--$(pwd | sed 's|^/||;s|/|-|g')--
ls -t "$S"/*.jsonl 2>/dev/null | head -10

# Most recent session for this directory
SESSION=$(ls -t "$S"/*.jsonl 2>/dev/null | head -1)

# Header info
head -1 "$SESSION" | jq '{id: .id, cwd: .cwd, started: .timestamp, parentSession}'

# Find named sessions
for f in "$S"/*.jsonl; do
  name=$(jq -r 'select(.type == "session_info") | .name' "$f" 2>/dev/null | tail -1)
  [ -n "$name" ] && echo "$name → $f"
done
```

## Conversation text

```bash
# All user messages, handling string and content-block array forms
jq -r 'select(.type == "message" and .message.role == "user") |
  .message.content |
  if type == "string" then .
  else [.[] | select(.type == "text") | .text] | join("\n")
  end' "$SESSION"

# All assistant text responses, excluding thinking and tool calls
jq -r 'select(.type == "message" and .message.role == "assistant") |
  [.message.content[] | select(.type == "text") | .text] |
  join("\n") | select(length > 0)' "$SESSION"

# Chronological message-role sequence
jq -r 'select(.type == "message") | .message.role' "$SESSION"
```

## Tool and file usage

```bash
# Tool call counts
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall") | .name' "$SESSION" |
  sort | uniq -c | sort -rn

# Failed tool results with preview
jq -c 'select(.type == "message" and .message.role == "toolResult" and .message.isError == true) |
  {tool: .message.toolName,
   preview: ([.message.content[] | select(.type == "text") | .text[:240]] | join(" "))}' "$SESSION"

# All files touched by read/edit/write tool calls
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] |
  select(.type == "toolCall" and (.name == "read" or .name == "edit" or .name == "write")) |
  .arguments.path' "$SESSION" | sort -u

# Edit complexity: edit calls and number of replacements per call
jq 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall" and .name == "edit") |
  {path: .arguments.path, replacements: (.arguments.edits | length)}' "$SESSION"
```

## Costs and dashboard

```bash
# Total assistant cost and turn count
jq -s '[.[] | select(.type == "message" and .message.role == "assistant") |
  .message.usage.cost.total] |
  {total_cost_usd: add, assistant_turns: length}' "$SESSION"

# Compact whole-file dashboard. Reminder: includes abandoned branches.
jq -s '
  (.[0] | {session_id: .id, cwd: .cwd, started: .timestamp, parentSession}) +
  {
    entries: ([.[] | select(.type != "session")] | length),
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
    compactions: [.[] | select(.type == "compaction")] | length,
    branch_summaries: [.[] | select(.type == "branch_summary")] | length
  }
' "$SESSION"
```

## Active branch extraction

Most jq snippets above inspect the whole file. For branched sessions, use the
active branch when the question is “what context did the current conversation see?”

```bash
# Print active-branch entries as compact JSON, newest leaf inferred from final entry.
# This assumes the final non-header entry is the current leaf, which matches normal
# append-only session use.
jq -s '
  . as $all |
  ($all | map(select(.type != "session"))) as $entries |
  ($entries | map({key: .id, value: .}) | from_entries) as $byId |
  def walk($id):
    if $id == null then []
    else ($byId[$id] as $e | walk($e.parentId) + [$e])
    end;
  walk(($entries[-1] // {}).id)
' "$SESSION"
```

Pipe that into additional jq filters when whole-file analysis would be misleading.

## Subagent sessions

This repo's subagent extension stores each subagent run as a normal Pi session
file plus a parent-scoped manifest:

```text
~/.pi/agent/subagent-sessions/--<cwd-encoding>--/<parent-session-id>/
  manifest.json
  <uuid>.jsonl
```

Manifest entries observed in this repo include:

- `id`
- `agent`
- `agentSource`
- `description`
- `prompt`
- `sessionFile`
- `timestamp`
- `exitCode`
- `usage.{input,output,cost}`
- `durationMs`
- `provider`
- `model`
- `thinking`
- `attempts[]`

```bash
# Locate subagent runs for a parent session
PARENT_ID=$(head -1 "$SESSION" | jq -r '.id')
PARENT_CWD=$(head -1 "$SESSION" | jq -r '.cwd')
SUBAGENT_DIR=~/.pi/agent/subagent-sessions/--$(echo "$PARENT_CWD" | sed 's|^/||;s|/|-|g')--/$PARENT_ID

# List subagent runs
jq -r '.subagents[] |
  "\(.agent) [\(.agentSource)] \(.description) — exit:\(.exitCode) \(.durationMs)ms $\(.usage.cost)"' \
  "$SUBAGENT_DIR/manifest.json" 2>/dev/null

# Cost/duration summary
jq '{total_cost: [.subagents[].usage.cost] | add,
     total_duration_ms: [.subagents[].durationMs] | add,
     count: (.subagents | length),
     by_agent: [.subagents | group_by(.agent)[] |
       {agent: .[0].agent, count: length, cost: [.[].usage.cost] | add}]}' \
  "$SUBAGENT_DIR/manifest.json" 2>/dev/null

# Failed subagents
jq '.subagents[] | select(.exitCode != 0) |
  {agent, description, exitCode, prompt: .prompt[:240]}' \
  "$SUBAGENT_DIR/manifest.json" 2>/dev/null

# Tool usage per subagent session
for f in "$SUBAGENT_DIR"/*.jsonl; do
  echo "=== $(basename "$f") ==="
  jq -r 'select(.type == "message" and .message.role == "assistant") |
    .message.content[] | select(.type == "toolCall") | .name' "$f" |
    sort | uniq -c | sort -rn
done
```

## When in doubt

If schema details matter, read the official docs and/or inspect TypeScript types in
Pi's installed packages. If the task is operational session forensics, start with
these recipes and adapt them to the question.

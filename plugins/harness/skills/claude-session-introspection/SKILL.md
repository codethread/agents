---
name: claude-session-introspection
description: >
  Practical Claude Code session forensics quickstart. Use when the user wants to
  inspect Claude Code .jsonl session transcripts, locate a session from a message
  they saw in the UI, extract user/assistant messages, audit tool calls (reads,
  edits, writes, bash), pull a tool result for a given request, or check session
  cost/usage (deferred to ccusage). Covers the on-disk session schema, the
  ~/.claude (or CLAUDE_CONFIG_DIR) layout, and the harness plugin's stable
  dialogue log for clean user/assistant Q&A extraction.
---

# Claude Code Session Introspection

Operational notes and a small jq cookbook for inspecting Claude Code session
transcripts.

Anthropic documents the on-disk entry format as internal: "scripts that parse
these files directly can break on any release"
(https://code.claude.com/docs/en/sessions). The schema below is reconstructed
from observed `.jsonl` files and is **not** authoritative — field names drift
across Claude Code versions (see `version` on each entry). When a recipe returns
nothing, re-derive the shape from the file before trusting the snippet
(`jq -r '.type' "$SESSION" | sort | uniq -c`).

## Prefer stable sources first

Reach for raw transcript parsing only when these don't cover the question:

- **Dialogue (user ↔ assistant text)**: sessions run with the harness plugin
  enabled also write a stable, plugin-owned JSONL dialogue log to
  `${XDG_STATE_HOME:-$HOME/.local/state}/claude-dialogue/<session_id>.jsonl`
  (schema v1 and queries: `../../README.md`, the harness plugin README). Prefer
  it whenever it exists for the session; it already excludes tool noise,
  thinking, and mid-turn preamble.
- **Cost / token usage**: defer to ccusage — `bunx ccusage session --json`
  (fallback: `npx -y ccusage session --json`; also `daily`, `blocks`, see
  `--help`). Transcript usage entries carry **no cost field**, and pricing
  tables drift; don't hand-roll cost math.

## Variables

| Variable       | Value                                                      | Notes                                          |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `BASE_DIR`     | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`                      | Config root; `CLAUDE_CONFIG_DIR` overrides it  |
| `PROJECTS_DIR` | `BASE_DIR/projects`                                        | All project-scoped session files live here     |
| `CWD_ENCODING` | Replace every `/` **and** `_` in the absolute cwd with `-` | Observed, version-sensitive (see caveat below) |
| `SESSION_DIR`  | `PROJECTS_DIR/<CWD_ENCODING>/`                             | Sessions for one working directory             |
| `SESSION_GLOB` | `SESSION_DIR/*.jsonl`                                      | One file per session; filename is the UUID     |

The encoding is **observed, not documented**, and is lossy: both `/` and `_`
collapse to `-` (so distinct paths can map to the same directory), and it is **not**
the Pi `--…--` wrapping. Examples:

- `/Users/ct/dev/projects/agents` → `-Users-ct-dev-projects-agents`
- `/Users/ct/dev/projects/pandoras-box__god-class` →
  `-Users-ct-dev-projects-pandoras-box--god-class` (`__` → `--`)

Because the transform is lossy and may drift, **prefer locating by session id**
(`fd "<id>.jsonl" "$PROJECTS_DIR"`) or by message-substring search (below) over
reconstructing `SESSION_DIR` from `pwd`. When you do reconstruct it, verify a hit
by reading `.cwd` off a conversation entry rather than trusting the path.

## Ground rules

- Never modify session files. Treat JSONL transcripts as append-only history.
- One JSON object per line; each line is independently parseable. No array wrapper.
- The filename (minus `.jsonl`) is the `sessionId`, also stamped on every entry.
- Entries chain via `parentUuid` → `uuid` (a linked list). `parentUuid` is `null`
  on the first entry of a chain.
- `.message.content` is **not** uniform:
  - user content is a **string** for typed messages and command/hook-injected
    text, or a **content-block array** — usually carrying `tool_result` blocks,
    but sometimes `text` blocks (skill-content injections with `isMeta: true`,
    `[Request interrupted by user]` markers)
  - assistant content is **always an array** of blocks: `text`, `thinking`,
    `tool_use`
- Genuinely-typed user messages are best identified by `promptSource == "typed"`
  (equivalently `origin.kind == "human"`). Both fields exist **only on typed
  entries** — absence on one entry doesn't mean an old session. The
  string-content heuristic also matches slash-command envelopes
  (`<command-name>…`) and hook-injected messages; fall back to it only when no
  entry in the whole session carries `promptSource` (older versions).
- Tool results are **not** their own `type`. They are `type: "user"` entries whose
  `message.content[]` holds `tool_result` blocks, plus a structured top-level
  `toolUseResult` field.
- `isSidechain: true` marks subagent (Task tool) entries; they share the same file
  and `sessionId` as the parent but form their own `parentUuid` chain.
- Non-conversation entry types exist (`mode`, `permission-mode`, `attachment`,
  `last-prompt`, `system`, `summary`, `queue-operation`, `custom-title`,
  `agent-name`, and others that come and go, e.g. `file-history-snapshot`,
  `ai-title`) — filter them out for conversation analysis by selecting only
  `type == "user"` / `type == "assistant"`.
- **A single assistant response can span multiple `assistant` rows** sharing one
  `.message.id` (e.g. a text row then a tool_use row). Row-based snippets below are
  therefore approximate: dedupe/group by `.message.id` when you need true turn
  counts or whole-response text (see "Conversation extraction").

## Schema cheat-sheet

Common envelope on conversation entries (`user` / `assistant`):

```
type, uuid, parentUuid, isSidechain, sessionId, timestamp,
cwd, gitBranch, version, userType, entrypoint
```

| `type`            | shape / key fields                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `user`            | `message.role:"user"`, `message.content`: string **or** array; `promptId`, `promptSource`, `origin`; optional `isMeta` |
| `assistant`       | `message.role:"assistant"`, `message.content[]` blocks; `message.{id,model,stop_reason,usage}`; `requestId`            |
| (tool result)     | a `user` entry: `message.content[]` has `{type:"tool_result", tool_use_id, content}` + top-level `toolUseResult`       |
| `attachment`      | `attachment.{type,content,...}` (e.g. skill listings) — context, not a message                                         |
| `mode`            | `mode`: `"normal"` \| `"plan"`                                                                                         |
| `permission-mode` | `permissionMode`: e.g. `"acceptEdits"`, `"analyzeOnly"`                                                                |
| `last-prompt`     | `lastPrompt`, `leafUuid` (resume bookkeeping)                                                                          |
| `summary`         | rollup entry written on compaction/resume                                                                              |
| `queue-operation` | `operation`: `"enqueue"` \| `"remove"`; `content` on enqueue (message-queue bookkeeping)                               |
| `custom-title`    | `customTitle` (session title)                                                                                          |
| `agent-name`      | `agentName` (session agent name)                                                                                       |
| `system`          | `subtype`, `isMeta`, `durationMs`, … (harness notices)                                                                 |

Assistant content blocks:

- `{type:"text", text}` — visible response prose
- `{type:"thinking", thinking, signature}` — extended thinking
- `{type:"tool_use", id, name, input}` — a tool **request**; `id` is `toolu_…`

Tool-request → result linking: the assistant `tool_use.id` equals the `tool_use_id`
on the matching `tool_result` block in a later `user` entry.

## Finding sessions

**Your own session**: if you are the running Claude Code agent, your session id
is in the Bash tool environment as `$CLAUDE_CODE_SESSION_ID`. Your own dialogue
log (when the harness plugin was active at session start) is
`${XDG_STATE_HOME:-$HOME/.local/state}/claude-dialogue/$CLAUDE_CODE_SESSION_ID.jsonl`,
and your own transcript resolves via the `fd` recipe below with that id.

```bash
BASE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# The current session, from inside it
SESSION_ID="$CLAUDE_CODE_SESSION_ID"

# Most robust: locate a known session id anywhere under projects/ (no encoding guess)
fd "$SESSION_ID.jsonl" "$BASE_DIR/projects" | head -1

# Or by reconstructed cwd encoding (/ and _ → -). Lossy; verify with .cwd after.
SDIR="$BASE_DIR/projects/$(pwd | sed 's|[/_]|-|g')"

# Sessions for the current directory, newest first
ls -t "$SDIR"/*.jsonl 2>/dev/null | head -10

# Most recent session for this directory
SESSION=$(ls -t "$SDIR"/*.jsonl 2>/dev/null | head -1)

# Quick summary of any session (cwd/branch live on conversation entries, not the
# leading mode/permission-mode lines, so pick them independently)
jq -sr '(map(select(.sessionId))[0].sessionId) as $id | (map(select(.cwd))[0]) as $h |
  "session: \($id)\ncwd: \($h.cwd // "?")\nbranch: \($h.gitBranch // "?")\nentries: \(length)"' "$SESSION"
```

### Find a session by a message you saw in the UI

The reliable handle is text from a message. Content is JSON-escaped in the file
(newlines → `\n`, quotes → `\"`), so search a **short, single-line, lowercase-safe
substring** — long multi-word phrases that wrapped in the UI may straddle an
escaped newline and fail to match.

```bash
BASE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# Search every session for a substring (case-insensitive). Prints matching files.
rg -il --fixed-strings 'summarise the session' "$BASE_DIR"/projects/*/*.jsonl

# Newest match wins when several hit — rank by mtime:
rg -il --fixed-strings 'summarise the session' "$BASE_DIR"/projects/*/*.jsonl |
  xargs ls -t 2>/dev/null | head -1

# Confirm the hit: show the user messages that matched, with timestamps
SESSION=<path-from-above>
jq -r 'select(.type=="user" and (.message.content|type=="string")) |
  select(.message.content | ascii_downcase | contains("summarise the session")) |
  "\(.timestamp)  \(.message.content[:120])"' "$SESSION"
```

## Conversation extraction

```bash
# All genuinely-typed user messages. promptSource=="typed" excludes slash-command
# envelopes and hook-injected text, but the field exists only on typed entries,
# so decide per session (not per entry) whether it's available; fall back to the
# string-content heuristic on older sessions that never set it.
jq -sr '(any(.[]; .promptSource != null)) as $new |
  .[] | select(.type=="user") |
  select(if $new then .promptSource=="typed"
         else (.message.content|type=="string") end) |
  .message.content' "$SESSION"

# All assistant text responses (excludes thinking and tool calls). One response
# may span several rows sharing .message.id, so merge by id (then re-sort to file
# order, since group_by reorders) to reassemble whole turns.
jq -sr '[.[] | select(.type=="assistant")]
  | group_by(.message.id) | sort_by(.[0].timestamp)
  | map([.[].message.content[] | select(.type=="text") | .text] | join("\n"))
  | map(select(length > 0)) | .[]' "$SESSION"

# Assistant thinking blocks
jq -r 'select(.type=="assistant") |
  .message.content[] | select(.type=="thinking") | .thinking' "$SESSION"

# Chronological transcript: role + first 200 chars of text
jq -r 'select(.type=="user" or .type=="assistant") |
  (.message.role) as $r |
  (if (.message.content|type)=="string" then .message.content
   else [.message.content[] | select(.type=="text") | .text] | join(" ")
   end) as $t |
  select($t|length>0) | "[\($r)] \($t[:200])"' "$SESSION"
```

## Tool calls (requests)

```bash
# Tool call counts by name
jq -r 'select(.type=="assistant") |
  .message.content[] | select(.type=="tool_use") | .name' "$SESSION" |
  sort | uniq -c | sort -rn

# Every tool request with its id and input (compact)
jq -c 'select(.type=="assistant") |
  .message.content[] | select(.type=="tool_use") |
  {id, name, input}' "$SESSION"

# All files touched by Read / Edit / Write (Claude Code uses `file_path`)
jq -r 'select(.type=="assistant") |
  .message.content[] |
  select(.type=="tool_use" and (.name=="Read" or .name=="Edit" or .name=="Write")) |
  .input.file_path' "$SESSION" | sort -u

# Files that were modified (Edit/Write only) — "what changed this session"
jq -r 'select(.type=="assistant") |
  .message.content[] |
  select(.type=="tool_use" and (.name=="Edit" or .name=="Write")) |
  "\(.name)\t\(.input.file_path)"' "$SESSION" | sort -u

# Every Bash command run
jq -r 'select(.type=="assistant") |
  .message.content[] | select(.type=="tool_use" and .name=="Bash") |
  .input.command' "$SESSION"
```

## Tool results (bonus)

Two views of a result: the human-readable `tool_result` content block, and the
structured top-level `toolUseResult` (e.g. Bash `{stdout,stderr,...}`, file ops
`{type,file,...}`). Link by `tool_use_id`.

```bash
# Result content block for a specific tool_use id
TID=toolu_01W9bmRoUHoQn4ALPEJDkqLd
jq -r --arg id "$TID" 'select(.type=="user" and (.message.content|type=="array")) |
  .message.content[] | select(.type=="tool_result" and .tool_use_id==$id) |
  (if (.content|type)=="string" then .content
   else [.content[] | select(.type=="text") | .text] | join("\n") end)' "$SESSION"

# Structured result for that same id (parsed metadata Claude Code attaches)
jq -c --arg id "$TID" 'select(.type=="user" and .toolUseResult) |
  select([.message.content[]? | select(.type=="tool_result") | .tool_use_id] | index($id)) |
  .toolUseResult' "$SESSION"

# Pair every request with its result preview (request name → first 200 chars out)
jq -s '
  (map(select(.type=="assistant") |
    .message.content[] | select(.type=="tool_use") |
    {id, name}) ) as $reqs |
  (map(select(.type=="user" and (.message.content|type=="array")) |
    .message.content[] | select(.type=="tool_result") |
    {id: .tool_use_id,
     out: (if (.content|type)=="string" then .content
           else [.content[]? | select(.type=="text") | .text] | join(" ") end)})
    | map({(.id): .out}) | add // {}) as $res |
  $reqs | map(. + {result: ($res[.id] // null) | if type=="string" then .[:200] else . end})
' "$SESSION"
```

## Errors and failed tools

```bash
# Failed tools: a result block flagged is_error, OR a structured toolUseResult
# reporting success==false (some tools only signal failure via the latter).
# toolUseResult may be a string, so reach .success only when it is an object.
jq -c 'select(.type=="user") |
  (.message.content[]? | select(.type=="tool_result")) as $b |
  (if (.toolUseResult|type)=="object" then .toolUseResult.success else null end) as $ok |
  select($b.is_error == true or $ok == false) |
  {tool_use_id: $b.tool_use_id,
   success: $ok,
   preview: (if ($b.content|type)=="string" then $b.content[:240]
             else [$b.content[]? | select(.type=="text") | .text] | join(" ") | .[:240] end)}' "$SESSION"
```

## Subagent (sidechain) conversations

Task-tool subagents live in the **same** file, flagged `isSidechain: true`. Split
main from subagent traffic before analysis:

```bash
# Main-conversation entries only
jq -c 'select(.isSidechain != true)' "$SESSION"

# Subagent entries only
jq -c 'select(.isSidechain == true)' "$SESSION"

# Tool usage inside subagents
jq -r 'select(.isSidechain==true and .type=="assistant") |
  .message.content[] | select(.type=="tool_use") | .name' "$SESSION" |
  sort | uniq -c | sort -rn
```

## Whole-session dashboard

```bash
jq -s '
  (map(select(.sessionId))[0].sessionId) as $id |
  (map(select(.cwd))[0]) as $h |
  {
    session_id: $id,
    cwd: $h.cwd,
    branch: $h.gitBranch,
    version: $h.version,
    entries: length,
    user_msgs: [.[] | select(.type=="user" and (.message.content|type=="string"))] | length,
    assistant_rows: [.[] | select(.type=="assistant")] | length,
    assistant_turns: ([.[] | select(.type=="assistant") | .message.id] | unique | length),
    tool_calls: ([.[] | select(.type=="assistant") |
      .message.content[] | select(.type=="tool_use")] | length),
    tools: ([.[] | select(.type=="assistant") |
      .message.content[] | select(.type=="tool_use") | .name] |
      group_by(.) | map({(.[0]): length}) | add),
    sidechain_entries: [.[] | select(.isSidechain==true)] | length
  }
' "$SESSION"
```

## When in doubt

These shapes are observed, not documented, and vary by Claude Code `version`. If a
recipe is empty, dump the type histogram and a sample line of the relevant `type`
to re-derive the current field names, then adapt the jq. For authoritative
behaviour, consult the official docs (https://code.claude.com/docs/en/sessions,
https://code.claude.com/docs/en/hooks).

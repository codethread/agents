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

## Version-first workflow

Always run `claude --version` first and record the installed version. Then locate
the session using the guidance below.

Inspect `version` on conversation entries. A resumed session can contain
entries from several Claude Code versions; use the matching reference for each.

```text
Run version command -> locate session -> inspect version evidence
  |-- writer version identified -> read its reference
  `-- no writer version identified -> assume the latest reference applies
```

Read the selected reference before parsing schema-dependent fields or using its
queries. If the writer version is absent or ambiguous, assume the **latest
reference** below works; do not infer a release from timestamps. Keep session
files read-only.

For an unlisted installed or writer version, inspect representative records and
available source/types/docs for that version against the latest reference. If
queries fail or shapes differ, investigate the actual records before interpreting
an empty result as missing activity.

- If the covered schemas are unchanged, add the exact version to the table with
  **No change** and link directly to the existing comprehensive reference.
- If schemas differ, create `references/<version>.md`. Copy all still-applicable
  schema details, caveats, and queries from the previous reference, then update
  the differences. Each reference must stand alone; do not create delta-only
  files or chains of references to older versions.
- Record the verification evidence and its scope in the reference or table;
  do not claim compatibility from a version number alone. Update the table and
  latest-reference marker when applicable. Preserve references for older sessions.
- Make these updates in the source skills under
  `~/dev/projects/agents/plugins/harness/skills/claude-session-introspection/`,
  not an installed plugin cache. Follow that repository’s instructions, validate
  the changes, and **commit the updated skill, reference, and related docs in the
  agents repository** as part of the introspection work.

| Harness version | Schema reference                                    | No change |
| --------------- | --------------------------------------------------- | --------- |
| `2.1.223`       | [2.1.223](references/2.1.223.md) — latest reference | Baseline  |

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

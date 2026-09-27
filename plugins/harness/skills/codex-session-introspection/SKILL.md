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

## Version-first workflow

Always run `codex --version` first and record the installed version. Then locate
the session using the guidance below.

For raw rollouts, inspect `session_meta.payload.cli_version`. The desktop app
can use a different version from the shell CLI.

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
  `~/dev/projects/agents/plugins/harness/skills/codex-session-introspection/`,
  not an installed plugin cache. Follow that repository’s instructions, validate
  the changes, and **commit the updated skill, reference, and related docs in the
  agents repository** as part of the introspection work.

| Harness version      | Schema reference                                    | No change                                            |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `0.156.1`            | [0.156.1](references/0.156.1.md) — latest reference | Baseline                                             |
| `0.155.0-alpha.16.4` | [0.156.1](references/0.156.1.md)                    | Yes — covered rollout fields match local app records |

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
| `CODEX_ROOT`   | `${CODEX_HOME:-$HOME/.config/codex}`                   | Codex config/state root                    |
| `RAW_SESSIONS` | `CODEX_ROOT/sessions`                                  | Raw rollout JSONL fallback                 |
| `DEBUG_LOG`    | `DLG_DIR/debug/raw.jsonl`                              | Raw hook payloads when debug capture is on |

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

## Debugging capture

```bash
# Launch a fresh Codex process with raw hook payload capture enabled.
CODEX_DIALOGUE_CAPTURE_DEBUG=1 codex

# Inspect raw hook payloads.
jq -c '.' "${XDG_STATE_HOME:-$HOME/.local/state}/codex-dialogue/debug/raw.jsonl" | tail -20
```

Debug payloads are useful when a field is missing from the stable log. The hook
intentionally drops unsupported fields instead of blocking Codex.

## Finding raw rollouts

Use raw rollouts for sessions without dialogue capture or questions the stable
log cannot answer. This repo uses `~/.config/codex`; honor `CODEX_HOME` when set.

```bash
CODEX_ROOT="${CODEX_HOME:-$HOME/.config/codex}"
rg --files "$CODEX_ROOT/sessions" | rg 'rollout-.*\.jsonl$' |
  xargs ls -t 2>/dev/null | head -10
rg -il --fixed-strings 'text from the message' "$CODEX_ROOT/sessions" |
  xargs ls -t 2>/dev/null | head -1
RAW=<path-from-above>
jq -r 'select(.type=="session_meta") | .payload.cli_version' "$RAW"
```

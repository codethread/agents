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

## Version-first workflow

Always run `pi --version` first and record the installed version. Then locate
the session using the guidance below.

The session header’s `version` is the **file-format version**, not the Pi
release. Use explicit release metadata when available; a header value of `3`
alone does not identify a Pi release.

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
  `~/dev/projects/agents/plugins/harness/skills/pi-session-introspection/`,
  not an installed plugin cache. Follow that repository’s instructions, validate
  the changes, and **commit the updated skill, reference, and related docs in the
  agents repository** as part of the introspection work.

| Harness version | Schema reference                                  | No change                                    |
| --------------- | ------------------------------------------------- | -------------------------------------------- |
| `0.99.1`        | [0.99.1](references/0.99.1.md) — latest reference | Changed — message fields; no new entry types |
| `0.87.1`        | [0.87.1](references/0.87.1.md)                    | Baseline                                     |

## Prefer the stable dialogue log for dialogue

Pi runs with this repo's `dialogue-capture` extension enabled also write a
stable, schema-v1 JSONL dialogue log (prompts, final replies, file touches,
session end — tool noise and mid-turn preamble excluded) to
`${XDG_STATE_HOME:-$HOME/.local/state}/pi-dialogue/<session-id>.jsonl`. The
schema and jq cookbook live in the harness plugin README (`../../README.md`);
the Pi-specific event mapping and divergences are in
`pi/extensions/dialogue-capture/README.md`. Prefer that log for user↔assistant
Q&A extraction; use the selected reference for raw session parsing for everything else (tool audits,
costs, branches, manifests).

## Variables

| Variable               | Value                                                               | Notes                                  |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `SESSION_DIR`          | `~/.pi/agent/sessions/`                                             | Parent agent sessions                  |
| `SUBAGENT_SESSION_DIR` | `~/.pi/agent/subagent-sessions/`                                    | This repo's subagent extension storage |
| `CWD_ENCODING`         | Strip leading `/`, replace `/` with `-`, wrap with `--`             | Used in directory names                |
| `SESSION_GLOB`         | `SESSION_DIR/--<CWD_ENCODING>--/*.jsonl`                            | Sessions for a cwd                     |
| `SUBAGENT_MANIFEST`    | `SUBAGENT_SESSION_DIR/--<CWD_ENCODING>--/<parent-id>/manifest.json` | Subagent run index per parent          |

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

## Schema sources and subagent lookup

Use the installed Pi package’s `docs/session-format.md`, `docs/sessions.md`,
`docs/message-types.md`, `docs/compaction.md`, and `dist/core/session-manager.d.ts`
when verifying a new release. In the agents checkout these are under
`node_modules/@earendil-works/pi-coding-agent/`; do not assume a separate
`~/.pi/pi-source` checkout matches the installed release.

Subagent files live under
`~/.pi/agent/subagent-sessions/--<cwd-encoding>--/<parent-session-id>/`, alongside
`manifest.json` and, for swarms, `swarm-manifest.json`. Use the selected reference
for their fields and queries.

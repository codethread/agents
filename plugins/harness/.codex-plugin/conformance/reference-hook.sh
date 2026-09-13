#!/usr/bin/env bash
# Reference command for exercising Codex's hook boundary. This is not the
# production identity adapter and its fake-Strand protocol is fixture-private.
set -euo pipefail

context_max_bytes=${CODEX_FIXTURE_CONTEXT_MAX_BYTES:-4096}
strand_bin=${STRAND_BIN:?STRAND_BIN must point to the fixture fake}

payload=$(cat)
event_name=$(jq -er '.hook_event_name' <<<"$payload")

case "$event_name" in
  SessionStart)
    jq -e '
      (.session_id | type == "string" and length > 0) and
      (.cwd | type == "string" and length > 0) and
      (.source == "startup" or .source == "resume" or .source == "clear" or .source == "compact")
    ' >/dev/null <<<"$payload"
    ;;
  SubagentStart)
    jq -e '
      (.session_id | type == "string" and length > 0) and
      (.cwd | type == "string" and length > 0) and
      (.agent_id | type == "string" and length > 0)
    ' >/dev/null <<<"$payload"
    ;;
  *)
    printf 'unsupported fixture event: %s\n' "$event_name" >&2
    exit 64
    ;;
esac

request=$(jq -c '{
  harness: "codex",
  hook_event_name,
  session_id,
  cwd,
  source: (.source // null),
  agent_id: (.agent_id // null)
}' <<<"$payload")

stderr_file=$(mktemp)
stdout_file=$(mktemp)
trap 'rm -f "$stderr_file" "$stdout_file"' EXIT
bounded_warning() {
  jq -cn --arg message "$1" '{continue: true, systemMessage: $message}'
}

# Bound files even if the fake floods before the runner timeout fires. Bash's
# file-size ulimit uses 512-byte blocks, so 128 caps each capture near 64 KiB.
ulimit -f 128
set +e
{ printf '%s\n' "$request" | "$strand_bin" >"$stdout_file" 2>"$stderr_file"; } 2>>"$stderr_file"
strand_status=$?
set -e

if ((strand_status != 0)); then
  diagnostic=$(LC_ALL=C head -c 160 "$stderr_file" | tr '\n\r\t' '   ')
  bounded_warning "Millstrand startup unavailable (exit $strand_status): $diagnostic"
  exit 0
fi

strand_output_bytes=$(LC_ALL=C wc -c <"$stdout_file" | tr -d ' ')
if ((strand_output_bytes > context_max_bytes * 4)); then
  bounded_warning "Millstrand startup response exceeds the configured fixture limit; required context was not injected."
  exit 0
fi

set +e
context=$(jq -er '.additional_context | select(type == "string")' <"$stdout_file" 2>/dev/null)
parse_status=$?
set -e
if ((parse_status != 0)); then
  bounded_warning "Millstrand startup returned an invalid response; required context was not injected."
  exit 0
fi

context_bytes=$(LC_ALL=C printf '%s' "$context" | wc -c | tr -d ' ')
if ((context_bytes > context_max_bytes)); then
  bounded_warning "Millstrand startup context exceeds the configured fixture limit ($context_bytes > $context_max_bytes bytes); required context was not injected."
  exit 0
fi

jq -cn \
  --arg event "$event_name" \
  --arg context "$context" \
  '{hookSpecificOutput: {hookEventName: $event, additionalContext: $context}}'

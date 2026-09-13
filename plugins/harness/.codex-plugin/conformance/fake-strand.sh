#!/usr/bin/env bash
# Test double for the future Strand startup API. Its stdin format is private to
# this fixture and deliberately does not freeze a proposed production command.
set -euo pipefail

request=$(cat)
jq -e '
  (.harness == "codex") and
  (.session_id | type == "string" and length > 0) and
  (.cwd | type == "string" and length > 0) and
  (.hook_event_name == "SessionStart" or .hook_event_name == "SubagentStart")
' >/dev/null <<<"$request"

managed_environment_present=false
while IFS= read -r name; do
  if [[ "$name" == MILLSTRAND_* ]]; then
    managed_environment_present=true
  fi
done < <(compgen -e)

case "${FAKE_STRAND_MODE:-success}" in
  success)
    cwd=$(jq -r '.cwd' <<<"$request")
    if [[ "$cwd" == *"linked-worktree"* ]]; then
      workspace="/workspace/project/.millstrand"
    else
      workspace="$cwd/.millstrand"
    fi
    context="Your Millstrand identity is fixture-only-identity. Use fixture-only-identity for identity-bearing operations; pass --by-identity fixture-only-identity explicitly. Workspace: $workspace"
    if [[ -n "${FAKE_STRAND_LOG:-}" ]]; then
      jq -cn \
        --argjson request "$request" \
        --argjson managed_environment_present "$managed_environment_present" \
        --arg returned_context "$context" \
        '{request: $request, managed_environment_present: $managed_environment_present, managed_state: "none", returned_context: $returned_context}' \
        >>"$FAKE_STRAND_LOG"
    fi
    jq -cn \
      --arg context "$context" \
      --arg workspace "$workspace" \
      '{additional_context: $context, workspace: $workspace, managed_state: "none"}'
    ;;
  oversized)
    context="Your Millstrand identity is fixture-only-identity."
    for _ in {1..256}; do
      context+=" Required identity policy must remain complete."
    done
    jq -cn --arg context "$context" \
      '{additional_context: $context, workspace: "/workspace/project/.millstrand", managed_state: "none"}'
    ;;
  failure)
    for _ in {1..256}; do
      printf 'fake Strand unavailable; diagnostic payload must be bounded. ' >&2
    done
    printf '\n' >&2
    exit 70
    ;;
  flood)
    while :; do
      printf 'fake Strand output flood must be bounded. '
    done
    ;;
  hang)
    exec tail -f /dev/null
    ;;
  invalid-json)
    printf '{not-json}\n'
    ;;
  missing-context)
    printf '{"workspace":"/workspace/project/.millstrand"}\n'
    ;;
  empty-context)
    printf '{"additional_context":""}\n'
    ;;
  multiple-responses)
    printf '{"additional_context":"ambiguous fixture response"}\n%.0s' {1..2}
    ;;
  *)
    printf 'unknown FAKE_STRAND_MODE\n' >&2
    exit 64
    ;;
esac

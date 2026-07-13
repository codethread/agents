#!/usr/bin/env bash
# Capture stable dialogue and file-touch events from Claude Code hook payloads
# into ${XDG_STATE_HOME:-~/.local/state}/claude-dialogue/<session_id>.jsonl.
# Schema v1 is documented in plugins/harness/README.md; consumers rely on it,
# so change it additively only.
#
# Must never block the session (always exit 0) and must never write to stdout:
# on UserPromptSubmit, stdout is injected into the model's context.
set -u

# The window-title worker spawns a throwaway child `claude`; don't log its
# synthetic dialogue.
[ -n "${HARNESS_WINDOW_TITLE_CHILD:-}" ] && exit 0

dir="${XDG_STATE_HOME:-$HOME/.local/state}/claude-dialogue"
mkdir -p "$dir" 2>/dev/null || exit 0

payload=$(cat) || exit 0
hook_event_name=$(printf '%s' "$payload" | jq -r '.hook_event_name // empty' 2>/dev/null) || exit 0
payload_model=$(printf '%s' "$payload" | jq -r '.model // empty' 2>/dev/null || true)
payload_thinking_level=$(
	printf '%s' "$payload" | jq -r '.effort.level // env.CLAUDE_EFFORT // empty' 2>/dev/null || true
)
transcript_path=$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null || true)
transcript_model=""
if [[ "$hook_event_name" == "Stop" && -n "$transcript_path" ]]; then
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		if [ -f "$transcript_path" ]; then
			transcript_model=$(
				tail -200 "$transcript_path" 2>/dev/null |
					jq -sr '[.[] | select(.type == "assistant" and .isSidechain != true and .message.model) | .message.model] | last // empty' 2>/dev/null || true
			)
			[ -n "$transcript_model" ] && break
		fi
		sleep 0.1
	done
fi

model="${payload_model:-$transcript_model}"
thinking_level="$payload_thinking_level"

record=$(printf '%s' "$payload" | jq -c --arg model "$model" --arg thinking_level "$thinking_level" '
  def nullable($value): if $value == "" then null else $value end;
  def envelope: {
    v: 1,
    event: null,
    ts: (now | todate),
    session_id: (.session_id // "unknown"),
    prompt_id: (.prompt_id // null),
    cwd: (.cwd // null),
    agent_id: (.agent_id // null),
    agent_type: (.agent_type // null),
    model: nullable($model),
    thinking_level: nullable($thinking_level)
  };
  if .hook_event_name == "UserPromptSubmit" then
    envelope + {event: "prompt", text: .prompt}
  elif .hook_event_name == "Stop" then
    if (.agent_id // null) != null or (.last_assistant_message // "") == "" then empty
    else envelope + {event: "reply", text: .last_assistant_message} end
  elif .hook_event_name == "PostToolUse" then
    envelope + {event: "file", tool: .tool_name,
                file_path: (.tool_input.file_path // .tool_input.notebook_path // null)}
  elif .hook_event_name == "SessionEnd" then
    envelope + {event: "session_end", reason: (.reason // null)}
  else empty end
' 2>/dev/null) || exit 0

[ -n "$record" ] || exit 0
sid=$(printf '%s' "$record" | jq -r '.session_id')
printf '%s\n' "$record" >> "$dir/$sid.jsonl"
exit 0

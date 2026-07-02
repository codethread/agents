#!/usr/bin/env bash
# Capture stable dialogue and file-touch events from Codex hook payloads into
# ${XDG_STATE_HOME:-~/.local/state}/codex-dialogue/<session_id>.jsonl.
# Schema v1 is documented in plugins/harness/README.md.
#
# Must never block the session and must never write to stdout: UserPromptSubmit
# hook stdout can become model-visible context.
set -u

dir="${XDG_STATE_HOME:-$HOME/.local/state}/codex-dialogue"
mkdir -p "$dir" 2>/dev/null || exit 0

payload=$(cat) || exit 0

if [[ "${CODEX_DIALOGUE_CAPTURE_DEBUG:-}" == "1" ]]; then
	mkdir -p "$dir/debug" 2>/dev/null || true
	printf '%s\n' "$payload" >> "$dir/debug/raw.jsonl" 2>/dev/null || true
fi

record=$(printf '%s' "$payload" | jq -c '
  def first_value(paths):
    . as $root | reduce paths[] as $path (null; if . != null then . else ($root | getpath($path)?) end);
  def event_name:
    first_value([
      ["hook_event_name"], ["hookEventName"], ["event"], ["event_name"]
    ]);
  def session_id:
    first_value([
      ["session_id"], ["sessionId"], ["conversation_id"], ["conversationId"], ["thread_id"], ["threadId"]
    ]) // "unknown";
  def prompt_id:
    first_value([["prompt_id"], ["promptId"], ["turn_id"], ["turnId"]]);
  def text_prompt:
    first_value([["prompt"], ["user_prompt"], ["userPrompt"], ["input", "prompt"]]);
  def reply_text:
    first_value([
      ["last_assistant_message"], ["lastAssistantMessage"], ["assistant_message"], ["assistantMessage"],
      ["response"], ["output", "text"]
    ]);
  def tool_name:
    first_value([["tool_name"], ["toolName"], ["tool"], ["name"]]);
  def tool_input:
    first_value([["tool_input"], ["toolInput"], ["input"]]) // {};
  def file_path:
    tool_input.file_path // tool_input.filePath // tool_input.path // tool_input.notebook_path // tool_input.notebookPath // null;
  def command_text:
    tool_input.command // tool_input.cmd // null;
  def source_reason:
    first_value([["source"], ["reason"], ["start_source"], ["startSource"]]);
  def nullable($value): if $value == "" then null else $value end;
  def envelope: {
    v: 1,
    event: null,
    ts: (now | todate),
    session_id: session_id,
    prompt_id: prompt_id,
    cwd: (.cwd // null),
    agent_id: (.agent_id // .agentId // null),
    agent_type: (.agent_type // .agentType // null),
    model: nullable(.model // ""),
    thinking_level: nullable(.thinking_level // .thinkingLevel // .effort.level // "")
  };
  if event_name == "SessionStart" then
    envelope + {event: "session_start", reason: source_reason}
  elif event_name == "UserPromptSubmit" then
    envelope + {event: "prompt", text: text_prompt}
  elif event_name == "Stop" then
    if (.agent_id // .agentId // null) != null or (reply_text // "") == "" then empty
    else envelope + {event: "reply", text: reply_text} end
  elif event_name == "PostToolUse" then
    envelope + {event: "file", tool: tool_name, file_path: file_path, command: command_text}
  else empty end
' 2>/dev/null) || exit 0

[ -n "$record" ] || exit 0
sid=$(printf '%s' "$record" | jq -r '.session_id // "unknown"' 2>/dev/null) || exit 0
printf '%s\n' "$record" >> "$dir/$sid.jsonl" 2>/dev/null || true
exit 0

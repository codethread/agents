#!/usr/bin/env bash
# Async worker for window-title.sh: derive a terse kebab-case label for the
# session's first user message and apply it to the captured tmux window (or the
# terminal title bar when not in tmux). Detached, so a slow model never delays
# the user's prompt. Errors are swallowed; a title is best-effort.
#
# Args: $1 = tmux window id (empty when not in tmux), $2 = first user message.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=window-title-lib.sh
. "$here/window-title-lib.sh"

window_id="${1:-}"
prompt="${2:-}"
[ -n "$prompt" ] || exit 0

debug() {
	[ -n "${HARNESS_WINDOW_TITLE_DEBUG:-}" ] || return 0
	local dir="${XDG_STATE_HOME:-$HOME/.local/state}/claude-window-title"
	printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$dir/debug.log" 2>/dev/null || true
}

sys='You create ultra-short tmux window titles for Claude Code coding sessions.
Read the user'\''s request and reply with a terse 1 to 4 word label for the task.
Return only the label text. No explanations, quotes, markdown, or punctuation.
Prefer concrete nouns over generic verbs. Do not call tools.'

# Ask a small model for a semantic label; fall back to the prompt's own words.
raw=""
if command -v claude >/dev/null 2>&1; then
	run=(claude -p --model haiku --no-session-persistence --append-system-prompt "$sys" \
		"Create a very short window title (1-4 words) for this request. Output only the title:

<request>
$prompt
</request>")
	command -v timeout >/dev/null 2>&1 && run=(timeout 60 "${run[@]}")
	raw=$(HARNESS_WINDOW_TITLE_CHILD=1 "${run[@]}" 2>/dev/null || true)
fi
[ -n "$raw" ] || raw="$prompt"

title=$(kebab_case "$raw" 4 0)
[ -n "$title" ] || title="claude"

debug "window_id=${window_id:-none} raw=$(printf '%q' "$raw") title=$title"
apply_title "$window_id" "$title"
exit 0

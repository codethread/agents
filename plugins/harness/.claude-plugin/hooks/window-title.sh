#!/usr/bin/env bash
# Set the tmux window title (and terminal title) from the first user message,
# mirroring pi/extensions/ui/tmux-window-title for Claude Code.
#
# `/rename <text>` always wins: it sets the title immediately (kebab-cased, <=30
# chars), overriding the auto title even mid-session, and is blocked from the
# model. Otherwise, on the first prompt only, the title is derived asynchronously
# by window-title-apply.sh; a per-session sentinel keeps later prompts and
# resume/reload quiet. The tmux window is captured now so a later window switch
# can't retarget the rename.
#
# Must never block a normal prompt (exit 0) and must never write to stdout:
# on UserPromptSubmit, stdout is injected into the model's context.
set -u

# The worker spawns a child `claude` which re-fires this UserPromptSubmit hook;
# this env flag short-circuits that recursion.
[ -n "${HARNESS_WINDOW_TITLE_CHILD:-}" ] && exit 0

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=window-title-lib.sh
. "$here/window-title-lib.sh"

state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/claude-window-title"
mkdir -p "$state_dir" 2>/dev/null || exit 0

payload=$(cat) || exit 0
session_id=$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
prompt=$(printf '%s' "$payload" | jq -r '.prompt // empty' 2>/dev/null) || exit 0
[ -n "$session_id" ] || exit 0
[ -n "$prompt" ] || exit 0

sentinel="$state_dir/$session_id.done"

current_window_id() {
	[ -n "${TMUX:-}" ] || return 0
	tmux display-message -p -F '#{window_id}' ${TMUX_PANE:+-t "$TMUX_PANE"} 2>/dev/null || true
}

# `/rename <text>` overrides the title now and every time, bypassing the sentinel,
# then blocks the prompt (exit 2, stderr shown to the user) so nothing is sent to
# the model.
case "$prompt" in
	/rename | /rename\ *)
		arg="${prompt#/rename}"
		arg="${arg#"${arg%%[![:space:]]*}"}"
		title=$(kebab_case "$arg" 0 30)
		if [ -z "$title" ]; then
			printf 'window-title: usage: /rename <text>\n' >&2
			exit 2
		fi
		apply_title "$(current_window_id)" "$title"
		# Claim the sentinel so async auto-generation can't later override this.
		: > "$sentinel" 2>/dev/null || true
		printf 'window-title: renamed to %s\n' "$title" >&2
		exit 2
		;;
esac

# First prompt only: claim the sentinel, capture the window, derive asynchronously.
if ! (set -o noclobber; : > "$sentinel") 2>/dev/null; then
	exit 0
fi

HARNESS_WINDOW_TITLE_CHILD=1 nohup bash "$here/window-title-apply.sh" "$(current_window_id)" "$prompt" >/dev/null 2>&1 &
disown 2>/dev/null || true
exit 0

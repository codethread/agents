#!/usr/bin/env bash
# Shared helpers for the window-title hooks. Sourced, never executed.

# kebab_case <raw> <maxwords> <maxchars>
# Lowercase alphanumeric words joined with '-'. maxwords/maxchars of 0 mean no
# limit; a char cap trims back to a word boundary when the cut lands mid-word.
kebab_case() {
	local raw="$1" maxwords="${2:-0}" maxchars="${3:-0}" out
	out=$(printf '%s' "$raw" \
		| tr '[:upper:]' '[:lower:]' \
		| tr -c 'a-z0-9' ' ' \
		| awk -v mw="$maxwords" '{n=NF; if (mw>0 && mw<n) n=mw; for (i=1;i<=n;i++) printf (i>1?"-":"") $i}')
	if [ "$maxchars" -gt 0 ] && [ "${#out}" -gt "$maxchars" ]; then
		local nextchar="${out:maxchars:1}"
		out="${out:0:maxchars}"
		# Only drop the final token when the cut fell inside a word.
		if [ "$nextchar" != "-" ]; then
			case "$out" in *-*) out="${out%-*}" ;; esac
		fi
		out="${out%-}"
	fi
	printf '%s' "$out"
}

# apply_title <window_id> <title>
# Rename the captured tmux window, or set the terminal title bar via /dev/tty
# when not in tmux. Never writes to stdout (UserPromptSubmit injects it).
apply_title() {
	local window_id="$1" title="$2"
	if [ -n "$window_id" ]; then
		tmux rename-window -t "$window_id" "$title" 2>/dev/null || true
	elif [ -z "${TMUX:-}" ] && [ -e /dev/tty ]; then
		printf '\033]2;%s\033\\' "$title" > /dev/tty 2>/dev/null || true
	fi
}

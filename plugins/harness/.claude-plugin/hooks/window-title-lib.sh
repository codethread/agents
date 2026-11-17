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

# current_target
# Print the terminal container to rename, captured at prompt time: `tmux:<window_id>`
# inside tmux, `rex:<block_id>` inside Rex (the worker resolves the block's
# tab), or nothing otherwise. tmux wins when nested inside Rex.
current_target() {
	if [ -n "${TMUX:-}" ]; then
		local id
		id=$(tmux display-message -p -F '#{window_id}' ${TMUX_PANE:+-t "$TMUX_PANE"} 2>/dev/null) || true
		[ -n "$id" ] && printf 'tmux:%s' "$id"
	elif [ -n "${REX_BLOCK:-}" ]; then
		printf 'rex:%s' "$REX_BLOCK"
	fi
	return 0
}

# apply_title <target> <title>
# Rename the captured tmux window or Rex tab (window), or set the terminal
# title bar via /dev/tty outside tmux. Never writes to stdout (UserPromptSubmit
# injects it).
apply_title() {
	local target="$1" title="$2"
	case "$target" in
	tmux:*)
		tmux rename-window -t "${target#tmux:}" "$title" 2>/dev/null || true
		;;
	rex:*)
		local window_id
		window_id=$(rex --autostart=false --timeout 5s block inspect "${target#rex:}" --json 2>/dev/null \
			| jq -r '.block.window_id // empty' 2>/dev/null) || true
		[ -n "$window_id" ] && rex --autostart=false --timeout 5s window rename "$window_id" "$title" >/dev/null 2>&1
		;;
	*)
		[ -z "${TMUX:-}" ] && [ -e /dev/tty ] && printf '\033]2;%s\033\\' "$title" > /dev/tty 2>/dev/null
		;;
	esac
	return 0
}

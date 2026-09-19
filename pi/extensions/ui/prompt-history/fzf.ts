/**
 * `Ctrl+R` fuzzy prompt picker.
 *
 * Fuzzy matching and rendering are delegated to `fzf-tmux` by streaming the
 * history file through `jq`, so the extension only builds the pipeline, runs
 * it, and turns the selected line back into prompt text. `Tab` and
 * `Shift+Tab` cycle the listing scope (repo -> cwd -> global) inside the
 * picker via `reload()`, and the `load` event refreshes the header, so the
 * popup never closes and the query is preserved.
 */

export const PICKER_EXIT_NO_MATCH = 1;
export const PICKER_EXIT_MISSING_TOOL = 3;
export const PICKER_EXIT_CANCELLED = 130;

const FIELD_SEPARATOR = "\t";

/**
 * Bash pipeline run by the `Ctrl+R` shortcut. `$1` is the history cache path,
 * `$2` the canonical repo root, and `$3` the exact cwd.
 *
 * Each history record becomes one fzf line with two tab-separated fields:
 * field 1 is the display/search column (local time, cwd basename, one-line
 * prompt preview) and field 2 is the raw record, hidden from display and
 * search by `--with-nth`/`--nth`. `--tac` shows newest prompts first.
 */
export function buildPromptHistoryPickerScript(): string {
	return String.raw`set -u
for tool in jq fzf-tmux; do
	command -v "$tool" >/dev/null 2>&1 || {
		echo "prompt-history: Ctrl+R fuzzy history requires $tool on PATH." >&2
		exit ${PICKER_EXIT_MISSING_TOOL}
	}
done
[ -s "$1" ] || exit ${PICKER_EXIT_NO_MATCH}

tmp_root=$(printenv TMPDIR)
[ -n "$tmp_root" ] || tmp_root=/tmp
state_dir=$(mktemp -d "$tmp_root/pi-prompt-history-XXXXXX")
trap 'rm -rf "$state_dir"' EXIT

printf '%s' "$1" > "$state_dir/cache"
printf '%s' "$2" > "$state_dir/repo"
printf '%s' "$3" > "$state_dir/cwd"
printf '%s' repo > "$state_dir/scope"

cat > "$state_dir/scopes" <<'SCRIPT'
#!/usr/bin/env bash
set -u
dir=$1
mode=$2
cache=$(cat "$dir/cache")
repo=$(cat "$dir/repo")
cwd=$(cat "$dir/cwd")

case "$mode" in
	cycle)
		case "$(cat "$dir/scope")" in
			repo) printf '%s' cwd > "$dir/scope" ;;
			cwd) printf '%s' global > "$dir/scope" ;;
			*) printf '%s' repo > "$dir/scope" ;;
		esac
		exec bash "$dir/scopes" "$dir" emit
		;;
	cycle-back)
		case "$(cat "$dir/scope")" in
			repo) printf '%s' global > "$dir/scope" ;;
			global) printf '%s' cwd > "$dir/scope" ;;
			*) printf '%s' repo > "$dir/scope" ;;
		esac
		exec bash "$dir/scopes" "$dir" emit
		;;
	emit)
		jq -r --arg scope "$(cat "$dir/scope")" --arg repo "$repo" --arg cwd "$cwd" '
			select(
				($scope == "repo" and .repoRoot == $repo)
				or ($scope == "cwd" and .cwd == $cwd)
				or $scope == "global"
			)
			| "\(.timestamp / 1000 | strflocaltime("%Y-%m-%d %H:%M"))  \(.cwd | split("/") | last)  \(.message | gsub("\\s+"; " ") | ltrimstr(" ") | .[0:160])\t\(.)"
		' "$cache"
		;;
	header)
		case "$(cat "$dir/scope")" in
			repo) text='repo history · tab: cwd · shift-tab: global' ;;
			cwd) text='cwd history · tab: global · shift-tab: repo' ;;
			*) text='global history · tab: repo · shift-tab: cwd' ;;
		esac
		printf '%s · enter: insert · esc: cancel' "$text"
		;;
esac
SCRIPT

bash "$state_dir/scopes" "$state_dir" emit | fzf-tmux -p 85%,85% \
	--tac --delimiter='\t' --with-nth=1 --nth=1 --layout=reverse \
	--with-shell='bash -c' \
	--prompt='history> ' \
	--header="$(bash "$state_dir/scopes" "$state_dir" header)" \
	--bind="tab:reload(bash \"$state_dir/scopes\" \"$state_dir\" cycle),shift-tab:reload(bash \"$state_dir/scopes\" \"$state_dir\" cycle-back),load:transform-header(bash \"$state_dir/scopes\" \"$state_dir\" header)"
`;
}

/**
 * Turn one selected fzf line (`<display>\t<record>`) back into prompt text.
 * Returns undefined when fzf produced no selection (cancelled or no match).
 */
export function parsePromptHistoryPickerSelection(stdout: string): string | undefined {
	const line = stdout.split("\n")[0] ?? "";
	if (!line) return undefined;

	const separatorIndex = line.indexOf(FIELD_SEPARATOR);
	if (separatorIndex === -1) {
		throw new Error("Fuzzy prompt history selection is missing its record payload.");
	}

	const payload = line.slice(separatorIndex + 1);
	const value = JSON.parse(payload) as { message?: unknown };
	if (typeof value.message !== "string") {
		throw new Error("Fuzzy prompt history selection is missing a string message.");
	}
	return value.message;
}

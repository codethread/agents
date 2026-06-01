#!/usr/bin/env bash
# Render a rich-response HTML file from the template and open it in the browser.
# Body comes from stdin — invoke with a heredoc.
#
# Usage:
#   render.sh "<title>" [output-path] <<'HTML'
#   <h2>Section</h2>
#   <p>Body content as semantic HTML…</p>
#   HTML
#
# If output-path is omitted, slugified from title into /tmp/rich-<slug>.html.
# TTL env var (default 300s) controls how long the localhost server stays up.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: render.sh <title> [output-path]    (body on stdin)" >&2
  exit 1
fi

title="$1"
output="${2:-}"

script_dir=$(cd "$(dirname "$0")" && pwd)
template="$script_dir/template.html"

if [[ ! -f "$template" ]]; then
  echo "template missing: $template" >&2
  exit 1
fi

if [[ -z "$output" ]]; then
  slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-|-$//g')
  [[ -z "$slug" ]] && slug="doc"
  output="/tmp/rich-${slug}.html"
fi

# Substitute placeholders. Title is HTML-escaped; body is injected as-is
# (agent writes semantic HTML intentionally).
python3 -c '
import sys, html
template_path, title, output_path = sys.argv[1:4]
body = sys.stdin.read()
with open(template_path) as f: t = f.read()
t = t.replace("{{TITLE}}", html.escape(title, quote=False))
t = t.replace("{{BODY}}", body)
with open(output_path, "w") as f: f.write(t)
' "$template" "$title" "$output"

"$script_dir/validate.sh" "$output" >&2
"$script_dir/serve.sh" "$output" "${TTL:-300}" >&2

echo "$output"

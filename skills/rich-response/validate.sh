#!/usr/bin/env bash
# Validate a rendered rich-response HTML file before opening it.
# Usage: validate.sh <path-to-html>
# Exits 0 on success, 1 on any failure.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: validate.sh <path-to-html>" >&2
  exit 1
fi

file="$1"
fail=0

err() { echo "FAIL: $1" >&2; fail=1; }
ok()  { echo "  ok: $1"; }

if [[ ! -f "$file" ]]; then
  err "file does not exist: $file"
  exit 1
fi
ok "file exists: $file"

# Placeholder substitution
if grep -q '{{[A-Z_]*}}' "$file"; then
  unsubbed=$(grep -oE '\{\{[A-Z_]+\}\}' "$file" | sort -u | tr '\n' ' ')
  err "unsubstituted placeholders: $unsubbed"
else
  ok "all {{PLACEHOLDERS}} substituted"
fi

# Required tags
for tag in '<title>' '<h1>' '</body>' '</html>'; do
  if ! grep -q "$tag" "$file"; then
    err "missing required tag: $tag"
  else
    ok "found $tag"
  fi
done

# Detect orphan <pre class="mermaid"> nested inside <code> (common LLM mistake)
if grep -qE '<code[^>]*>\s*<pre class="mermaid"' "$file"; then
  err "mermaid block wrapped in <code> — will not render"
fi

# Detect unclosed <details> / <pre> / <table> via tag-balance check.
# Strip HTML comments and <script> bodies first so documentation mentions of
# tags inside them don't skew the count.
stripped=$(python3 -c '
import re, sys
with open(sys.argv[1]) as f: h = f.read()
h = re.sub(r"<!--.*?-->", "", h, flags=re.DOTALL)
h = re.sub(r"<script\b[^>]*>.*?</script>", "", h, flags=re.DOTALL | re.IGNORECASE)
sys.stdout.write(h)
' "$file")

for tag in details pre table; do
  open=$( { printf '%s' "$stripped" | grep -oE "<$tag[^>]*>" || true; } | wc -l | tr -d ' ')
  close=$( { printf '%s' "$stripped" | grep -oE "</$tag>" || true; } | wc -l | tr -d ' ')
  if [[ "$open" != "$close" ]]; then
    err "$tag tag mismatch: $open opening vs $close closing"
  else
    ok "$tag tags balanced ($open)"
  fi
done

if [[ $fail -ne 0 ]]; then
  echo "validation FAILED" >&2
  exit 1
fi
echo "validation passed"

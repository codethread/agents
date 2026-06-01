#!/usr/bin/env bash
# Open a rendered rich-response file via a short-lived localhost server.
# Sidesteps file:// security restrictions (CORS, dynamic ESM imports) that
# break Mermaid v10+ and similar libraries.
#
# Usage: serve.sh <path-to-html> [ttl-seconds]
# Default TTL: 300s. Server auto-terminates after TTL so we don't leak processes.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: serve.sh <path-to-html> [ttl-seconds]" >&2
  exit 1
fi

file=$(/usr/bin/python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$1")
ttl="${2:-300}"

if [[ ! -f "$file" ]]; then
  echo "file does not exist: $file" >&2
  exit 1
fi

dir=$(dirname "$file")
name=$(basename "$file")
encoded_name=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$name")

# Use a deterministic high port for each rendered file so refreshing/retrying the
# browser tab keeps hitting the same URL for the same output path.
port=$(python3 -c 'import hashlib, sys; h = int(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:8], 16); print(49152 + (h % 10000))' "$file")
url="http://localhost:${port}/${encoded_name}"

http_ok() {
  python3 - "$url" <<'PY' >/dev/null 2>&1
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=0.5) as r:
        raise SystemExit(0 if r.status == 200 else 1)
except Exception:
    raise SystemExit(1)
PY
}

if http_ok; then
  echo "serving $url (existing server, not reopened, ttl unknown)"
  exit 0
fi

if /usr/bin/nc -z 127.0.0.1 "$port" 2>/dev/null; then
  echo "port $port is already in use but is not serving $url" >&2
  exit 1
fi

# Serve the file's directory only (keeps blast radius small).
( cd "$dir" && exec python3 -m http.server "$port" --bind 127.0.0.1 ) >/dev/null 2>&1 &
pid=$!

# Auto-kill after TTL so we don't leak a server if the user forgets.
( sleep "$ttl" && kill "$pid" 2>/dev/null ) >/dev/null 2>&1 &

# Brief wait for the server to serve the exact file, not just accept sockets.
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "server failed to start: python http.server exited" >&2
    exit 1
  fi
  if http_ok; then
    ready=1
    break
  fi
  sleep 0.1
done

if [[ "$ready" -ne 1 ]]; then
  kill "$pid" 2>/dev/null || true
  echo "server failed to serve $url" >&2
  exit 1
fi

open "$url"
echo "serving $url (pid $pid, ttl ${ttl}s)"
echo "kill early: kill $pid"

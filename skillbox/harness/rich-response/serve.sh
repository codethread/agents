#!/usr/bin/env bash
# Publish a rendered rich-response file through the persistent document server.
#
# Usage: serve.sh <path-to-html>

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: serve.sh <path-to-html>" >&2
  exit 1
fi

script_dir=$(cd "$(dirname "$0")" && pwd)
exec python3 "$script_dir/server.py" publish "$1"

#!/usr/bin/env bash
set -euo pipefail

git diff --check
flock -w 180 /tmp/millstrand-test.lock pnpm check

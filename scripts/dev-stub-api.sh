#!/usr/bin/env bash
#
# dev-stub-api.sh — start scripts/stub-api.mjs (the stand-in for the worker) in a
# fresh run folder: logs/<date>/run-<N>/stub-api.log, every line timestamped.
# Refuses to start if the port is already in use. Rules: docs/ios/testing.md.

set -euo pipefail

PORT="${MOZOL_WORKER_PORT:-8790}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/run-dir.sh
. "$SCRIPT_DIR/lib/run-dir.sh"

fail() { echo "[dev-stub-api] ERROR: $*" >&2; exit 1; }

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  fail "port $PORT is already in use. Stop the other instance first (scripts/stop-all.sh)."
fi

new_run_dir "stub-api"
LOG="$RUN_DIR/stub-api.log"
echo "[dev-stub-api] logging to $LOG"

exec > >(stamp | tee -a "$LOG") 2>&1
MOZOL_WORKER_PORT="$PORT" exec node "$SCRIPT_DIR/stub-api.mjs"

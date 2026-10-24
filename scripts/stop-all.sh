#!/usr/bin/env bash
#
# stop-all.sh — stop what scripts/start-all.sh started: the worker (wrangler
# dev) or the stub API, the web dev server (vite) and the sim-logs stream. The simulator and the
# installed app are left as they are. Prints what it stopped for each part.

set -uo pipefail

WORKER_PORT="${MOZOL_WORKER_PORT:-8790}"
WEB_PORT="${MOZOL_WEB_PORT:-5190}"

info() { echo "[stop-all] $*"; }

stop_pattern() {
  local label="$1" pattern="$2" pids still
  pids="$(pgrep -f "$pattern" 2>/dev/null | tr '\n' ' ')"
  if [ -z "$pids" ]; then
    info "$label: nothing found (pattern: '$pattern')"
    return 0
  fi
  info "$label: stopping PID(s) ${pids}"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  still="$(pgrep -f "$pattern" 2>/dev/null | tr '\n' ' ')"
  if [ -n "$still" ]; then
    info "$label: still alive after TERM (PID(s): ${still}), sending KILL"
    # shellcheck disable=SC2086
    kill -9 $still 2>/dev/null || true
  fi
}

stop_pattern "worker" "wrangler dev --port $WORKER_PORT"
stop_pattern "stub API" "node .*scripts/stub-api.mjs"
stop_pattern "web" "vite --port $WEB_PORT"
stop_pattern "sim-logs" "simctl spawn.*log stream.*net.vrizo.mozol"
info "done. The simulator and the installed app are left running."

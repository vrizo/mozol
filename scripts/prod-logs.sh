#!/usr/bin/env bash
#
# prod-logs.sh — production worker logs (wrangler tail) into a fresh run folder:
# logs/<date>/run-N/prod.log, one JSON event per line, timestamped like every
# other log file. Runs until stopped, or for --for <seconds>.
#
# Usage:
#   scripts/prod-logs.sh                  follow until Ctrl+C
#   scripts/prod-logs.sh --for 120        follow for 120 seconds, then stop
#   scripts/prod-logs.sh --status error   only failed requests
#
# Uses the Cloudflare token from .env, never echoing it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/run-dir.sh
. "$SCRIPT_DIR/lib/run-dir.sh"
WORKER_DIR="$REPO_ROOT/worker"
ENV_FILE="$REPO_ROOT/.env"

DURATION=""
TAIL_ARGS=(--format json)
while [ $# -gt 0 ]; do
  case "$1" in
    --for)    DURATION="${2:-}"; shift 2 ;;
    --status) TAIL_ARGS+=(--status "${2:-}"); shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "[prod-logs] ERROR: unknown option $1" >&2; exit 1 ;;
  esac
done

fail() { echo "[prod-logs] ERROR: $*" >&2; exit 1; }

[ -f "$WORKER_DIR/wrangler.jsonc" ] || fail "no worker/wrangler.jsonc — the worker does not exist yet."
[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE. Token setup: docs/security/cloudflare-tokens.md."
CLOUDFLARE_API_TOKEN="$(env_value "$ENV_FILE" CLOUDFLARE_API_TOKEN)"
CLOUDFLARE_ACCOUNT_ID="$(env_value "$ENV_FILE" CLOUDFLARE_ACCOUNT_ID)"
[ -n "$CLOUDFLARE_API_TOKEN" ] && [ -n "$CLOUDFLARE_ACCOUNT_ID" ] || fail "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID missing in $ENV_FILE."
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
if [ -n "$DURATION" ]; then
  [[ "$DURATION" =~ ^[0-9]+$ ]] || fail "--for takes seconds, got '$DURATION'."
fi

new_run_dir "worker-prod-tail"
LOG="$RUN_DIR/prod.log"
echo "[prod-logs] writing to $LOG"

cd "$WORKER_DIR"
pnpm exec wrangler tail "${TAIL_ARGS[@]}" > >(stamp >> "$LOG") 2>&1 &
TAIL_PID=$!
trap 'pkill -P $TAIL_PID 2>/dev/null; kill $TAIL_PID 2>/dev/null; true' EXIT INT TERM

if [ -n "$DURATION" ]; then
  sleep "$DURATION"
  echo "[prod-logs] stopped after ${DURATION}s. Read with: tail -c 4000 $LOG"
else
  wait "$TAIL_PID"
fi

#!/usr/bin/env bash
#
# dev-worker.sh — start the mozol worker locally (wrangler dev), with every
# output line timestamped into a fresh run folder:
#
#   logs/<YYYY-MM-DD>/run-<N>/worker.log
#   logs/<YYYY-MM-DD>/run-<N>/run.json
#   logs/current -> <YYYY-MM-DD>/run-<N>
#
# Refuses to start if the port is already in use. Loads CLOUDFLARE_API_TOKEN /
# CLOUDFLARE_ACCOUNT_ID from .env without echoing them.

set -euo pipefail

PORT="${MOZOL_WORKER_PORT:-8790}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/run-dir.sh
. "$SCRIPT_DIR/lib/run-dir.sh"
WORKER_DIR="$REPO_ROOT/worker"
ENV_FILE="$REPO_ROOT/.env"

fail() { echo "[dev-worker] ERROR: $*" >&2; exit 1; }

[ -f "$WORKER_DIR/wrangler.jsonc" ] || fail "no worker/wrangler.jsonc — the worker does not exist yet."

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  holder="$(lsof -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')"
  fail "port $PORT is already in use (PID(s): ${holder}). Stop the other instance first."
fi

[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE (copy .env.example, fill CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)."
CLOUDFLARE_API_TOKEN="$(env_value "$ENV_FILE" CLOUDFLARE_API_TOKEN)"
CLOUDFLARE_ACCOUNT_ID="$(env_value "$ENV_FILE" CLOUDFLARE_ACCOUNT_ID)"
[ -n "$CLOUDFLARE_API_TOKEN" ]  || fail "CLOUDFLARE_API_TOKEN not set in $ENV_FILE."
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] || fail "CLOUDFLARE_ACCOUNT_ID not set in $ENV_FILE."
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

new_run_dir "worker-dev"
LOG="$RUN_DIR/worker.log"
echo "[dev-worker] logging to $LOG"
echo "[dev-worker] logs/current -> ${RUN_DIR#"$LOGS_ROOT"/}"

# Route stdout+stderr through stamp + tee, then hand the process to wrangler so
# signals reach it directly.
exec > >(stamp | tee -a "$LOG") 2>&1
echo "[dev-worker] === wrangler dev starting on port $PORT ==="
cd "$WORKER_DIR"
# shellcheck disable=SC2086
exec pnpm exec wrangler dev --port "$PORT" ${WRANGLER_DEV_FLAGS:-}

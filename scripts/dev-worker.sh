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
#
# Before wrangler starts:
#   - writes worker/.dev.vars (mode 600): APP_ORIGIN of the local web app,
#     ANALYSIS_MODE fixture (claude with MOZOL_ANALYSIS=claude), PUSH_MODE log,
#     and ANTHROPIC_API_KEY when .env has it;
#   - builds the web app when web/dist is missing (wrangler needs the assets folder).

set -euo pipefail

PORT="${MOZOL_WORKER_PORT:-8790}"
WEB_PORT="${MOZOL_WEB_PORT:-5190}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/run-dir.sh
. "$SCRIPT_DIR/lib/run-dir.sh"
WORKER_DIR="$REPO_ROOT/worker"
ENV_FILE="$REPO_ROOT/.env"
DEV_VARS="$WORKER_DIR/.dev.vars"

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

ANALYSIS_MODE="${MOZOL_ANALYSIS:-fixture}"
case "$ANALYSIS_MODE" in
  fixture|claude) ;;
  *) fail "MOZOL_ANALYSIS must be fixture or claude, got '$ANALYSIS_MODE'." ;;
esac
ANTHROPIC_API_KEY="$(env_value "$ENV_FILE" ANTHROPIC_API_KEY)"
if [ "$ANALYSIS_MODE" = claude ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  fail "MOZOL_ANALYSIS=claude needs ANTHROPIC_API_KEY in $ENV_FILE."
fi

new_run_dir "worker-dev"
LOG="$RUN_DIR/worker.log"
echo "[dev-worker] logging to $LOG"
echo "[dev-worker] logs/current -> ${RUN_DIR#"$LOGS_ROOT"/}"

# Route stdout+stderr through stamp + tee, then hand the process to wrangler so
# signals reach it directly.
exec > >(stamp | tee -a "$LOG") 2>&1

(
  umask 077
  {
    printf 'APP_ORIGIN=http://localhost:%s\n' "$WEB_PORT"
    printf 'ANALYSIS_MODE=%s\n' "$ANALYSIS_MODE"
    printf 'PUSH_MODE=log\n'
    if [ -n "$ANTHROPIC_API_KEY" ]; then printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY"; fi
  } > "$DEV_VARS"
)
chmod 600 "$DEV_VARS"
if [ -n "$ANTHROPIC_API_KEY" ]; then key_state="set"; else key_state="not in .env"; fi
echo "[dev-worker] wrote worker/.dev.vars: ANALYSIS_MODE=$ANALYSIS_MODE, PUSH_MODE=log, ANTHROPIC_API_KEY $key_state"

if [ ! -d "$REPO_ROOT/web/dist" ]; then
  echo "[dev-worker] web/dist is missing — building the web app"
  ( cd "$REPO_ROOT" && pnpm --filter web build ) || fail "web build failed."
fi

echo "[dev-worker] === wrangler dev starting on port $PORT ==="
cd "$WORKER_DIR"
# shellcheck disable=SC2086
exec pnpm exec wrangler dev --port "$PORT" ${WRANGLER_DEV_FLAGS:-}

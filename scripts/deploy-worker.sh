#!/usr/bin/env bash
#
# deploy-worker.sh — the one path for deploying the MOZOL worker to production.
# Agents run it themselves. Steps, each stops the script on failure:
#
#   1. refuse uncommitted changes in worker/, web/ or shared/ (--allow-dirty overrides)
#   2. worker tests (cd worker && pnpm test)
#   3. web app build (when web/ exists)
#   4. D1 migrations to production
#   5. wrangler deploy
#   6. GET https://mozol.vrizo.net/api/health
#
# Every deploy writes its own run folder: logs/<date>/run-N/run.json and
# deploy.log (full output, including the version id wrangler prints).
#
# Usage:
#   scripts/deploy-worker.sh                 full deploy
#   scripts/deploy-worker.sh --check         token and config check only, no changes
#   scripts/deploy-worker.sh --allow-dirty   deploy with uncommitted changes
#
# Reads CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from .env, never echoing them.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/run-dir.sh
. "$SCRIPT_DIR/lib/run-dir.sh"
WORKER_DIR="$REPO_ROOT/worker"
ENV_FILE="$REPO_ROOT/.env"
DB_NAME="${MOZOL_DB_NAME:-mozol}"

CHECK_ONLY=false
ALLOW_DIRTY=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    --allow-dirty) ALLOW_DIRTY=true ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "[deploy] ERROR: unknown argument: $arg" >&2; exit 1 ;;
  esac
done

fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }
info() { echo "[deploy] $*"; }

[ -f "$WORKER_DIR/wrangler.jsonc" ] || fail "no worker/wrangler.jsonc — the worker does not exist yet."
[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE (copy .env.example). Token setup: docs/security/cloudflare-tokens.md."
CLOUDFLARE_API_TOKEN="$(env_value "$ENV_FILE" CLOUDFLARE_API_TOKEN)"
CLOUDFLARE_ACCOUNT_ID="$(env_value "$ENV_FILE" CLOUDFLARE_ACCOUNT_ID)"
PROD_URL="https://mozol.vrizo.net"
[ -n "$CLOUDFLARE_API_TOKEN" ]  || fail "CLOUDFLARE_API_TOKEN not set in $ENV_FILE."
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] || fail "CLOUDFLARE_ACCOUNT_ID not set in $ENV_FILE."
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

info "checking the Cloudflare token"
( cd "$WORKER_DIR" && pnpm exec wrangler whoami > /dev/null 2>&1 ) || fail "wrangler whoami failed with the token from .env."
if [ "$CHECK_ONLY" = true ]; then
  info "check passed. Nothing deployed."
  exit 0
fi

if [ "$ALLOW_DIRTY" = false ] && [ -n "$(git -C "$REPO_ROOT" status --porcelain -- worker web shared)" ]; then
  fail "uncommitted changes in worker/, web/ or shared/. Commit them first, or pass --allow-dirty for a deploy Vitalii asked for."
fi

new_run_dir "worker-deploy"
LOG="$RUN_DIR/deploy.log"
info "run folder: $RUN_DIR"
exec > >(stamp | tee -a "$LOG") 2>&1

cd "$WORKER_DIR"
info "=== 1/5 tests ==="
pnpm test || fail "worker tests failed. Nothing deployed."

info "=== 2/5 web build ==="
if [ -f "$REPO_ROOT/web/package.json" ]; then
  ( cd "$REPO_ROOT" && pnpm --filter web build ) || fail "web build failed. Nothing deployed."
else
  info "no web/package.json"
fi

info "=== 3/5 migrations ($DB_NAME, remote) ==="
if [ -d migrations ]; then
  pnpm exec wrangler d1 migrations apply "$DB_NAME" --remote || fail "remote migrations failed. Worker not deployed."
else
  info "no worker/migrations folder"
fi

info "=== 4/5 deploy ==="
pnpm exec wrangler deploy || fail "wrangler deploy failed."

info "=== 5/5 health ==="
ok=false
for _ in 1 2 3 4 5; do
  if curl -fsS --max-time 5 "$PROD_URL/api/health" 2>/dev/null | grep -q '"ok":true'; then ok=true; break; fi
  sleep 3
done
[ "$ok" = true ] || fail "$PROD_URL/api/health is not healthy after the deploy. Read production logs: scripts/prod-logs.sh."
info "deployed and healthy. Log: $LOG"

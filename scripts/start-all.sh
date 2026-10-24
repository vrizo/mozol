#!/usr/bin/env bash
#
# start-all.sh — bring up the local MOZOL stack in one command.
#
#   1. local D1 migrations, then scripts/dev-worker.sh in the background; waits
#      for GET /api/health. The worker opens a fresh run folder (logs/current).
#   2. the web app (Vite dev server) — web.log in the same run folder (--no-web skips)
#   3. the iOS app: xcodegen, build, install and launch on the simulator pointed
#      at the local worker, plus scripts/sim-logs.sh into app.log (--no-app skips)
#
# A part that is already running (its port is listening) is reused, and the
# script says so. Every failure stops the script with an error.
# Stop everything with scripts/stop-all.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/run-dir.sh
. "$SCRIPT_DIR/lib/run-dir.sh"
CURRENT="$LOGS_ROOT/current"

WORKER_PORT="${MOZOL_WORKER_PORT:-8790}"
WEB_PORT="${MOZOL_WEB_PORT:-5190}"
DB_NAME="${MOZOL_DB_NAME:-mozol}"
UDID="${MOZOL_SIM_UDID:-898564DD-FAE8-4AB0-9BF5-CBF17DB72852}"
BUNDLE_ID="app.mozol"
DERIVED_DATA="$REPO_ROOT/ios/.build-dd"

SKIP_WEB=false
SKIP_APP=false
for arg in "$@"; do
  case "$arg" in
    --no-web) SKIP_WEB=true ;;
    --no-app) SKIP_APP=true ;;
    *) echo "[start-all] ERROR: unknown argument: $arg" >&2; exit 1 ;;
  esac
done

fail() { echo "[start-all] ERROR: $*" >&2; exit 1; }
info() { echo "[start-all] $*"; }
listening() { lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# --- 1. worker ---------------------------------------------------------------
info "=== 1/3 worker (port $WORKER_PORT) ==="
[ -f "$REPO_ROOT/worker/wrangler.jsonc" ] || fail "no worker/wrangler.jsonc — the worker does not exist yet."

if listening "$WORKER_PORT"; then
  info "port $WORKER_PORT already listening — reusing the running worker and its run folder."
else
  if [ -d "$REPO_ROOT/worker/migrations" ]; then
    info "applying D1 migrations to the local database '$DB_NAME'"
    ( cd "$REPO_ROOT/worker" && pnpm exec wrangler d1 migrations apply "$DB_NAME" --local 2>&1 | tail -c 2000 ) \
      || fail "local migrations failed."
  fi
  nohup "$SCRIPT_DIR/dev-worker.sh" > /dev/null 2>&1 &
  WORKER_PID=$!
  disown "$WORKER_PID" 2>/dev/null || true
  info "dev-worker.sh started (PID $WORKER_PID), waiting for /api/health (up to 30 s)"
  up=false
  for _ in $(seq 1 30); do
    kill -0 "$WORKER_PID" 2>/dev/null || fail "dev-worker.sh exited before it became healthy. Read logs/current/worker.log."
    if curl -fsS --max-time 2 "http://localhost:$WORKER_PORT/api/health" 2>/dev/null | grep -q '"ok":true'; then up=true; break; fi
    sleep 1
  done
  [ "$up" = true ] || fail "no healthy /api/health within 30 s. Read logs/current/worker.log."
fi
info "worker healthy at http://localhost:$WORKER_PORT"
[ -L "$CURRENT" ] || fail "no logs/current symlink after the worker start."
RUN_DIR="$(cd "$CURRENT" && pwd -P)"

# --- 2. web ------------------------------------------------------------------
WEB_STATUS="skipped (--no-web)"
if [ "$SKIP_WEB" = false ]; then
  info "=== 2/3 web (port $WEB_PORT) ==="
  [ -f "$REPO_ROOT/web/package.json" ] || fail "no web/package.json — the web app does not exist yet. Use --no-web."
  if listening "$WEB_PORT"; then
    info "port $WEB_PORT already listening — reusing the running web dev server."
  else
    nohup bash -c "cd '$REPO_ROOT' && pnpm --filter web exec vite --port $WEB_PORT --strictPort 2>&1 \
      | perl -MPOSIX -MTime::HiRes=time -ne 'BEGIN{\$|=1} my \$t=time; printf \"%s.%03dZ %s\", POSIX::strftime(\"%Y-%m-%dT%H:%M:%S\", gmtime(int(\$t))), int((\$t-int(\$t))*1000), \$_' \
      >> '$RUN_DIR/web.log'" > /dev/null 2>&1 &
    disown $! 2>/dev/null || true
    up=false
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 2 -o /dev/null "http://localhost:$WEB_PORT/" 2>/dev/null; then up=true; break; fi
      sleep 1
    done
    [ "$up" = true ] || fail "web dev server did not answer within 30 s. Read $RUN_DIR/web.log."
  fi
  WEB_STATUS="http://localhost:$WEB_PORT"
fi

# --- 3. iOS app ----------------------------------------------------------------
APP_STATUS="skipped (--no-app)"
if [ "$SKIP_APP" = false ]; then
  info "=== 3/3 iOS app (simulator $UDID) ==="
  [ -f "$REPO_ROOT/ios/project.yml" ] || fail "no ios/project.yml — the iOS app does not exist yet. Use --no-app."
  state="$(xcrun simctl list devices 2>/dev/null | grep "$UDID" || true)"
  [ -n "$state" ] || fail "simulator $UDID not found (xcrun simctl list devices)."
  if ! echo "$state" | grep -q "(Booted)"; then
    info "booting the simulator"
    xcrun simctl boot "$UDID" 2>/dev/null || true
    xcrun simctl bootstatus "$UDID" -b > /dev/null || fail "simulator $UDID did not boot."
  fi

  ( cd "$REPO_ROOT/ios" && xcodegen generate > /dev/null ) || fail "xcodegen generate failed."

  # No CODE_SIGNING_ALLOWED=NO: an unsigned simulator app fails every Keychain call.
  set +e
  ( cd "$REPO_ROOT/ios" && xcodebuild build \
      -project Mozol.xcodeproj -scheme Mozol \
      -configuration Debug -sdk iphonesimulator \
      -destination "platform=iOS Simulator,id=$UDID" \
      -derivedDataPath "$DERIVED_DATA" 2>&1 | grep -E "error|BUILD" | head -50 )
  status=${PIPESTATUS[0]:-$?}
  set -e
  [ "$status" -eq 0 ] || fail "xcodebuild build failed. Rerun without the grep filter to see the full output."

  APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/Mozol.app"
  [ -d "$APP_PATH" ] || fail "built app not found at $APP_PATH."
  xcrun simctl install "$UDID" "$APP_PATH" || fail "simctl install failed."
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  launch_out="$(xcrun simctl launch "$UDID" "$BUNDLE_ID" -mozol.apiBaseURL "http://localhost:$WORKER_PORT")" \
    || fail "simctl launch failed."

  nohup "$SCRIPT_DIR/sim-logs.sh" --udid "$UDID" > /dev/null 2>&1 &
  disown $! 2>/dev/null || true
  APP_STATUS="launched (pid ${launch_out##*: })"
fi

echo
echo "======================================================================"
echo "[start-all] stack is up"
echo "  worker:    http://localhost:$WORKER_PORT"
echo "  web:       $WEB_STATUS"
echo "  app:       $APP_STATUS"
echo "  logs:      $RUN_DIR"
echo "  stop with: scripts/stop-all.sh"
echo "======================================================================"

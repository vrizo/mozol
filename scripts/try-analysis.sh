#!/usr/bin/env bash
#
# try-analysis.sh — runs the real analysis model on one fixture transcript, so a
# person can check the prompt. Writes logs/<date>/run-N/analysis.json (the
# result, the model, tokens, duration, unmatched quotes) and try-analysis.log.
# It spends money: run it only when asked (docs/backend/ai-analysis.md).
#
# Usage:
#   scripts/try-analysis.sh shared/fixtures/jamie/meeting-completed.json
#   scripts/try-analysis.sh shared/fixtures/json/transcript.json
#
# ANALYSIS_MODEL and ANALYSIS_EFFORT override the defaults (claude-opus-5-5,
# medium). NATIVE_LANGUAGE overrides the sample user's native language (ru).
# ANALYSIS_MODE=fixture checks the script without a model call.
# Reads ANTHROPIC_API_KEY from .env, never echoing it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/run-dir.sh
. "$SCRIPT_DIR/lib/run-dir.sh"
WORKER_DIR="$REPO_ROOT/worker"
ENV_FILE="$REPO_ROOT/.env"

fail() { echo "[try-analysis] ERROR: $*" >&2; exit 1; }

case "${1:-}" in
  ""|-h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac
[ $# -eq 1 ] || fail "takes one fixture path, got $#."
FIXTURE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
[ -f "$FIXTURE" ] || fail "no file $1."

if [ "${ANALYSIS_MODE:-claude}" = "claude" ]; then
  [ -f "$ENV_FILE" ] || fail "missing $ENV_FILE."
  ANTHROPIC_API_KEY="$(env_value "$ENV_FILE" ANTHROPIC_API_KEY)"
  [ -n "$ANTHROPIC_API_KEY" ] || fail "ANTHROPIC_API_KEY missing in $ENV_FILE."
  export ANTHROPIC_API_KEY
fi

new_run_dir "try-analysis"
echo "[try-analysis] run folder $RUN_DIR"

cd "$WORKER_DIR"
pnpm exec tsx scripts/try-analysis.ts "$FIXTURE" "$RUN_DIR" 2>&1 | stamp | tee "$RUN_DIR/try-analysis.log"

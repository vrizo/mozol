#!/usr/bin/env bash
#
# start-web.sh — start the web app (the landing page is its home route "/")
# with the local worker behind it, without the iOS app. Same as
# scripts/start-all.sh --no-app; extra arguments (for example --stub) pass through.
# Stop with scripts/stop-all.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/start-all.sh" --no-app "$@"

#!/usr/bin/env bash
#
# sim-push.sh — feed a silent push payload to the MOZOL app on the simulator.
#
#   scripts/sim-push.sh                                    sends the deliveries push of shared/CONTRACT.md:
#                                                          {"mozol":{"v":1,"type":"deliveries","pending":1}}
#   scripts/sim-push.sh '{"mozol":{"v":1,"type":"test"}}'  the test push; the JSON object's keys go next to "aps"
#
# The simulator delivers `xcrun simctl push` silent pushes to the legacy
# background-fetch callback without their payload. So this script writes the
# payload to <app container>/tmp/debug-push.json and posts the Darwin
# notification net.vrizo.mozol.debug.push; a Debug build feeds it to the same
# handler a real silent push reaches. The app must be running. Real APNs
# delivery is checked on a device. Simulator: $MOZOL_SIM_UDID or the iPhone 17.

set -euo pipefail

UDID="${MOZOL_SIM_UDID:-898564DD-FAE8-4AB0-9BF5-CBF17DB72852}"
DEFAULT_DATA='{"mozol":{"v":1,"type":"deliveries","pending":1}}'
DATA="${1:-$DEFAULT_DATA}"

fail() { echo "[sim-push] ERROR: $*" >&2; exit 1; }

BUNDLE_ID="net.vrizo.mozol"
CONTAINER="$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data 2>/dev/null)" \
  || fail "net.vrizo.mozol is not installed on $UDID."
mkdir -p "$CONTAINER/tmp"
node -e '
  const data = JSON.parse(process.argv[1]);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("payload must be a JSON object");
  process.stdout.write(JSON.stringify({ aps: { "content-available": 1 }, ...data }));
' "$DATA" > "$CONTAINER/tmp/debug-push.json" || fail "payload is not a JSON object: $DATA"

SIZE="$(wc -c < "$CONTAINER/tmp/debug-push.json" | tr -d ' ')"
xcrun simctl spawn "$UDID" notifyutil -p net.vrizo.mozol.debug.push || fail "notifyutil failed on $UDID."
echo "[sim-push] payload of $SIZE bytes posted to $BUNDLE_ID on $UDID"

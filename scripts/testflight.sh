#!/usr/bin/env bash
#
# testflight.sh — archive the iOS app and upload it to TestFlight.
#
#   1. refuses to run with uncommitted changes in ios/, unless --allow-dirty is given
#   2. xcodegen, then MozolCore tests
#   3. archive (Release) into ios/.build-dd/archives/, build number = UTC YYYYMMDDHHMM
#   4. export with destination "upload": App Store Connect receives the build
#
# Signing is automatic through the App Store Connect API key: .env holds
# ASC_KEY_ID and ASC_ISSUER_ID, the key file is
# ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8. Rules and one-time
# setup: docs/deployment/testflight.md. Writes logs/<date>/run-N/testflight.log.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/run-dir.sh
. "$SCRIPT_DIR/lib/run-dir.sh"
ENV_FILE="$REPO_ROOT/.env"
IOS_DIR="$REPO_ROOT/ios"
TEAM_ID="5X3V5CCN2N"

ALLOW_DIRTY=false
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=true ;;
    *) echo "[testflight] ERROR: unknown argument: $arg" >&2; exit 1 ;;
  esac
done

fail() { echo "[testflight] ERROR: $*" >&2; exit 1; }
info() { echo "[testflight] $*"; }

if [ "$ALLOW_DIRTY" = false ] && [ -n "$(git -C "$REPO_ROOT" status --porcelain -- ios)" ]; then
  fail "uncommitted changes in ios/. Commit first, or pass --allow-dirty."
fi

[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE."
ASC_KEY_ID="$(env_value "$ENV_FILE" ASC_KEY_ID)"
ASC_ISSUER_ID="$(env_value "$ENV_FILE" ASC_ISSUER_ID)"
[ -n "$ASC_KEY_ID" ] || fail "ASC_KEY_ID not set in $ENV_FILE."
[ -n "$ASC_ISSUER_ID" ] || fail "ASC_ISSUER_ID not set in $ENV_FILE."
KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
[ -f "$KEY_PATH" ] || fail "no key file for ASC_KEY_ID at ~/.appstoreconnect/private_keys/."
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")

new_run_dir "testflight"
LOG="$RUN_DIR/testflight.log"
info "logging to $LOG"
exec > >(stamp | tee -a "$LOG") 2>&1

BUILD_NUMBER="$(date -u +%Y%m%d%H%M)"
ARCHIVE="$IOS_DIR/.build-dd/archives/Mozol-$BUILD_NUMBER.xcarchive"
info "build number $BUILD_NUMBER"

info "=== 1/4 xcodegen ==="
( cd "$IOS_DIR" && xcodegen generate ) || fail "xcodegen generate failed."

info "=== 2/4 MozolCore tests ==="
( cd "$IOS_DIR/MozolCore" && swift test 2>&1 | tail -5 ) || fail "MozolCore tests failed."

info "=== 3/4 archive ==="
set +e
xcodebuild archive -project "$IOS_DIR/Mozol.xcodeproj" -scheme Mozol -configuration Release \
  -destination "generic/platform=iOS" -archivePath "$ARCHIVE" -derivedDataPath "$IOS_DIR/.build-dd" \
  "${AUTH[@]}" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" > "$RUN_DIR/archive.log" 2>&1
status=$?
set -e
grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)" "$RUN_DIR/archive.log" | head -30
[ "$status" -eq 0 ] || fail "archive failed. Full output: $RUN_DIR/archive.log"

info "=== 4/4 export and upload ==="
OPTIONS="$RUN_DIR/ExportOptions.plist"
cat > "$OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST
set +e
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OPTIONS" \
  -exportPath "$RUN_DIR/export" "${AUTH[@]}" > "$RUN_DIR/export.log" 2>&1
status=$?
set -e
grep -E "error:|Upload succeeded|EXPORT (SUCCEEDED|FAILED)|Progress" "$RUN_DIR/export.log" | tail -20
[ "$status" -eq 0 ] || fail "export or upload failed. Full output: $RUN_DIR/export.log"

info "uploaded build $BUILD_NUMBER. App Store Connect processes it in 5 to 30 minutes."

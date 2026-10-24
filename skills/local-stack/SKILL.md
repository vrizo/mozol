---
name: local-stack
description: Start the MOZOL local stack (worker + web app + iOS simulator app), run the tests, and read logs and databases without guessing paths. Use whenever you build, launch or verify MOZOL on this Mac.
---

# local-stack

Do everything from the repo root.

    WORKER_PORT=8790   WEB_PORT=5190
    UDID=898564DD-FAE8-4AB0-9BF5-CBF17DB72852   # iPhone 17, or $MOZOL_SIM_UDID
    BUNDLE_ID=app.mozol

## 1. Start and stop

    scripts/start-all.sh            # worker + web + iOS app + sim-logs
    scripts/start-all.sh --no-app   # worker + web only
    scripts/start-all.sh --no-web --no-app
    scripts/stop-all.sh             # stops worker, web, sim-logs; leaves the simulator

start-all applies local D1 migrations, starts scripts/dev-worker.sh, waits for `GET /api/health`, then starts the web app and the iOS app. A part whose port already listens is reused, and the script says so. Every step fails loudly. Read the error; do not retry blindly.

Each worker start opens a fresh run folder logs/<date>/run-N/ (logs/current). web.log and app.log go into the same folder.

Health check: `curl -fsS http://localhost:8790/api/health` must print `{"ok":true}`.

## 2. Tests

- Worker: `cd worker && pnpm test` (vitest, no network).
- Web: `pnpm --filter web test`.
- MozolCore: `cd ios/MozolCore && swift test 2>&1 | tail -40`.
- iOS app and UI tests: build once, then rerun without building.

      xcodebuild build-for-testing -project ios/Mozol.xcodeproj -scheme Mozol \
        -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath ios/.build-dd
      xcodebuild test-without-building -project ios/Mozol.xcodeproj -scheme Mozol \
        -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath ios/.build-dd \
        -only-testing:MozolUITests/<Class>/<test>

  Iterate on one test, then the class, then the full suite as the final gate. Give every xcodebuild call a Bash timeout. Rules: docs/ios/testing.md.

## 3. iOS app by hand

    cd ios && xcodegen generate && cd ..
    xcodebuild build -project ios/Mozol.xcodeproj -scheme Mozol -configuration Debug \
      -sdk iphonesimulator -destination "platform=iOS Simulator,id=$UDID" \
      -derivedDataPath ios/.build-dd 2>&1 | grep -E "error:|BUILD"
    xcrun simctl install "$UDID" ios/.build-dd/Build/Products/Debug-iphonesimulator/Mozol.app
    xcrun simctl launch "$UDID" app.mozol -mozol.apiBaseURL http://localhost:8790
    scripts/sim-logs.sh   # background; appends to logs/current/app.log

Never pass CODE_SIGNING_ALLOWED=NO. When the app behaves unlike the source, rm -rf ios/.build-dd and build clean.

## 4. Logs

Use the reading-logs skill. Short version: `cat logs/current/run.json` first, then `scripts/logs.sh --last 10m` or `--rid <id>`. Never cat a whole log.

## 5. Databases (read-only)

Local D1:

    cd worker && pnpm exec wrangler d1 execute mozol --local --command "SELECT name FROM sqlite_master WHERE type='table'"

App store on the simulator (SwiftData, Z-prefixed tables):

    DATA=$(xcrun simctl get_app_container "$UDID" app.mozol data)
    sqlite3 -readonly "$DATA/Library/Application Support/default.store" ".tables"

## Notes

- Always `pnpm exec wrangler`; the global wrangler is old.
- nobardak uses port 8787 on this Mac; MOZOL uses 8790 and 5190, so both can run.
- Do not deploy from this loop. Deploys go through the deploy-worker skill.

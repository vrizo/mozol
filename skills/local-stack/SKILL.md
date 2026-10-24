---
name: local-stack
description: Start the MOZOL local stack (worker + web app + iOS simulator app), run the tests, and read logs and databases without guessing paths. Use whenever you build, launch or verify MOZOL on this Mac.
---

# local-stack

Do everything from the repo root.

    WORKER_PORT=8790   WEB_PORT=5190
    UDID=898564DD-FAE8-4AB0-9BF5-CBF17DB72852   # iPhone 17, or $MOZOL_SIM_UDID
    BUNDLE_ID=net.vrizo.mozol

## 1. Start and stop

    scripts/start-all.sh            # worker + web + iOS app + sim-logs
    scripts/start-all.sh --no-app   # worker + web only
    scripts/start-web.sh            # the same: worker + web app (landing page at /)
    scripts/start-all.sh --no-web --no-app
    scripts/start-all.sh --stub --no-web   # stub API instead of the worker (while worker/ does not exist)
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
    xcrun simctl launch "$UDID" net.vrizo.mozol -mozol.apiBaseURL http://localhost:5190   # 8790 with the stub or without the web dev server (docs/ios/testing.md)
    scripts/sim-logs.sh   # background; appends to logs/current/app.log

Never pass CODE_SIGNING_ALLOWED=NO. When the app behaves unlike the source, rm -rf ios/.build-dd and build clean.

## 3a. Deliveries and pushes without a worker

Sign in through the stub page in the app first (any email).

    curl -fsS -X POST localhost:8790/stub/deliveries -H 'content-type: application/json' -d '{}'   # queue the fixture recommendations
    curl -fsS localhost:8790/stub/state                                # users, devices, deliveries and outcomes
    scripts/sim-push.sh                                                # deliveries push into the running app
    scripts/sim-push.sh '{"mozol":{"v":1,"type":"test"}}'              # test push

The app claims at once on a push, or within 60 s (or on Refresh). `xcrun simctl push` does not work for silent pushes on the simulator: the payload is lost. Rules: docs/ios/testing.md.

## 4. Logs

Use the reading-logs skill. Short version: `cat logs/current/run.json` first, then `scripts/logs.sh --last 10m` or `--rid <id>`. Never cat a whole log. The stub API writes stub-api.log (one JSON line per request, `rid` first): `grep <rid> logs/current/stub-api.log`.

## 5. Databases (read-only)

Local D1:

    cd worker && pnpm exec wrangler d1 execute mozol --local --command "SELECT name FROM sqlite_master WHERE type='table'"

App store on the simulator (SwiftData, Z-prefixed tables):

    DATA=$(xcrun simctl get_app_container "$UDID" net.vrizo.mozol data)
    sqlite3 -readonly "$DATA/Library/Application Support/mozol.store" "SELECT ZTITLE, ZOUTCOMERAW, ZERRORCODE FROM ZDELIVERYRECORD"

Reminders on the simulator (the system store; find the file once, it holds ZREMCDREMINDER):

    STORES=$(find ~/Library/Developer/CoreSimulator/Devices/$UDID/data/Containers/Shared/AppGroup -path '*Container_v1/Stores' -type d)
    for DB in "$STORES"/Data-*.sqlite; do sqlite3 -readonly "$DB" "SELECT ZTITLE, ZPRIORITY, ZTIMEZONE, instr(ZNOTES, char(8291,8203,8291)) AS tagAt, length(ZNOTES) FROM ZREMCDREMINDER WHERE ZMARKEDFORDELETION = 0" 2>/dev/null; done

## Notes

- Always `pnpm exec wrangler`; the global wrangler is old.
- nobardak uses port 8787 on this Mac; MOZOL uses 8790 and 5190, so both can run.
- Do not deploy from this loop. Deploys go through the deploy-worker skill.

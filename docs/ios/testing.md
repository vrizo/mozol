Testing the iOS app

- MozolCore: `cd ios/MozolCore && swift test`. No simulator needed. Most logic is tested here.
- App-hosted tests (MozolTests) and UI tests (MozolUITests) run on the simulator.

Compile once, run many. `xcodebuild build-for-testing` builds the app and the test bundles into ios/.build-dd; `xcodebuild test-without-building` runs tests from those products. A rerun on unchanged sources must not pay for a build.

- Iterate on one test (`-only-testing:MozolUITests/Class/test`). Run the full class when the test is green, the full suite only as the final gate.
- Every phase has a wall-clock limit. A stuck run is killed loudly, never waited out.
- UI tests never call a real worker or AI. They run against an in-process stub server with canned answers.
- UI tests start in the state they need through DEBUG launch arguments (`-uitest.<name>`), not by walking through onboarding. Only onboarding tests walk onboarding.
- Every UI suite passes `-AppleLanguages (en)` and `-AppleLocale en_US`, so a simulator set to another language does not break English assertions.
- UI tests run serially on one simulator.
- UI tests save screenshots to tests/screenshots/<date>/; folders older than 7 days are deleted at suite start.

After a change to UI copy: build for the simulator, then `scripts/ios-strings.py` rebuilds Localizable.xcstrings from the strings the compiler found.

Local checks by agents

Base URL of the simulator app (launch argument `-mozol.apiBaseURL`, app-rules.md):

- With the worker and the web dev server: http://localhost:5190. Vite serves the pages (the app opens /app/signin) and passes /api to the worker on 8790, as on production, where one origin serves both.
- With the stub (`--stub`) or without the web dev server (`--no-web`): http://localhost:8790. The stub serves the pages the app opens itself; the worker serves the last web build.
- scripts/start-all.sh picks the URL by these rules.

Until the worker has the routes the app needs (B04, B05, B09), scripts/stub-api.mjs stands in for it on port 8790. It keeps everything in memory and implements the contract routes the app calls: /app/signin (a page with an email field; its button hands a code to the app), app-token, me, sign-out, devices, deliveries claim and results. It logs one JSON line per request with `rid`. Stub-only routes: POST /stub/app-code, POST /stub/deliveries, POST /stub/settings, GET /stub/state. Two rules the contract does not state: a result counts when its delivery is still claimed by that installation, and a marker that another installation holds is not handed out.

- `scripts/start-all.sh --stub --no-web` starts the stub instead of the worker, then builds and launches the app on the simulator pointed at it. stub-api.log goes into the run folder.
- Sign in through the stub page, then `curl -fsS -X POST localhost:8790/stub/deliveries -H 'content-type: application/json' -d '{}'` queues the two recommendations of shared/fixtures/deliveries/claim-response.json. `-d '{"items":[{"recommendation":{...}}]}'` queues your own; language, kind, itemKey, title, notes and embedLine are required. `curl -fsS localhost:8790/stub/state` shows users, devices and deliveries with their outcomes.
- `curl -fsS -X POST localhost:8790/stub/settings -H 'content-type: application/json' -d '{"embedInMyReminders":false}'` turns adding lines to the user's own reminders off.
- `scripts/sim-push.sh` feeds the deliveries push (`{"mozol":{"v":1,"type":"deliveries","pending":1}}`) to the running app; `scripts/sim-push.sh '{"mozol":{"v":1,"type":"test"}}'` feeds the test push. Any other JSON object goes next to `aps`. The simulator delivers `xcrun simctl push` silent pushes without their payload, so a Debug build listens for the Darwin notification `net.vrizo.mozol.debug.push` and reads the payload from tmp/debug-push.json in its container. It reaches the same handler as a real push. Real APNs delivery is checked on a TestFlight device.
- Check the result in app.log (categories api, sync, notify, store) and in the Reminders database of the simulator (skills/local-stack, section Databases): title, priority (0, none), time zone (the simulator's), due date, and the position of the hidden tag in the notes.
- `xcrun simctl privacy <udid> grant reminders net.vrizo.mozol` gives the app full access to Reminders without the alert.
- The simulator has no background task scheduler: scheduling a background refresh logs an error with code 1 there. The background path is covered by tests of AppEventHandler.

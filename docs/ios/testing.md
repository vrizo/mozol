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

The worker does not exist yet. scripts/stub-api.mjs stands in for it on port 8790: it implements the placeholder routes of shared/CONTRACT.md and a /signup page, and logs one JSON line per request with `rid`.

- `scripts/start-all.sh --stub --no-web` starts the stub instead of the worker, then builds and launches the app on the simulator pointed at it. stub-api.log goes into the run folder.
- `curl -fsS -X POST localhost:8790/stub/messages -d '{"text":"hi"}'` queues a message; the stub assigns the id. The app shows it within 60 seconds, or at once after Refresh.
- `scripts/sim-push.sh '{"text":"hi"}'` feeds a silent push payload (that JSON next to `aps`) to the running app. The simulator delivers `xcrun simctl push` silent pushes without their payload, so a Debug build listens for the Darwin notification `net.vrizo.mozol.debug.push` and reads the payload from tmp/debug-push.json in its container. It reaches the same handler as a real push. Real APNs delivery is checked on a TestFlight device.
- Check the result in the app store on the simulator (skills/local-stack) and in app.log, categories sync and notify.
- The simulator has no background task scheduler: scheduling a background refresh logs an error with code 1 there. The background path is covered by tests of AppEventHandler.

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

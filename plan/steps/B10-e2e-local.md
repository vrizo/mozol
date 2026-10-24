B10 Local end-to-end check

Track: backend. Depends on: B09. Next: B11.

Goal

One script proves the whole backend chain on the local stack, the way the iOS app and Jamie will use it: sign-up, app sign-in, device, Jamie webhook, analysis (fixture mode), recommendations, deliveries, outcomes, a second transcript with the same markers, and "send to phone".

Read first

- AGENTS.md, plan/README.md
- shared/CONTRACT.md, docs/backend/pipeline.md, docs/product/reminders.md
- skills/local-stack/SKILL.md, scripts/lib/run-dir.sh

Do

1. scripts/e2e-local.sh: runs against the local worker (http://localhost:8790; it refuses to run when /api/health does not answer, and says to start scripts/start-all.sh --no-app). Uses curl and jq. Writes its own run folder (new_run_dir "e2e-local") with e2e.log: one line per check, PASS or FAIL, with the request id. Never prints tokens or learning content.
2. The checks, in order, with a new random email each run:
   1. sign-up with Origin http://localhost:5190 and a cookie jar → 201;
   2. app-code with the cookie → 201; app-token with the code → 201 and a token; the same code again → 400 code_invalid;
   3. PUT /api/devices/<random installation id> with the bearer token and a fake 64-hex APNs token → 200;
   4. create a Jamie connection → webhook URL;
   5. post shared/fixtures/jamie/meeting-completed.json to it with data.user.email replaced by the new email and a new metadata.id → 202; the same body again → 200 duplicate;
   6. poll GET /api/transcripts/:id every second, at most 30 seconds, until analyzed (the recommend step sets it, so deliveries exist by then); language is "en"; recommendations are listed;
   7. claim → one delivery per recommendation of the transcript (14 with the fixture result), each with a schedule, and embedInMyReminders true; post outcomes for all of them (some created, some embedded) → all accepted;
   8. post the fixture again with another metadata.id → analyzed; claim → new deliveries whose markers equal the markers of the first claim for the same item keys; post outcomes;
   9. send an applied recommendation of the first transcript to the phone again (POST /api/recommendations/:id/deliver) → 202; claim → exactly that delivery; post a failed result three times across three claims (wait for nothing: post failed right after each claim) → the delivery ends failed;
   10. claim with an installation id that was never registered → 404; claim again with the registered installation while nothing is pending → no deliveries;
   11. the local D1 has push_log rows for the device (`wrangler d1 execute --local`).
3. The script exits with status 1 on the first FAIL and prints the run folder.
4. Add the script to skills/local-stack/SKILL.md (Tests section), one line.

Checks

- Run `scripts/e2e-local.sh` twice in a row on a running local stack (timeout 3 minutes each). Both runs pass.
- `pnpm --filter worker test`, `pnpm lint` still pass.

Out of scope

Real APNs and real Claude calls. The app-side placement algorithm (the iOS app tests it with shared/fixtures/matching/cases.json).

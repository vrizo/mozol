B09 Recommendations and deliveries

Track: backend. Depends on: B05, B08. Next: B10. W06 and the iOS work on reminders depend on this step.

Goal

After each analysis the worker turns every item into a recommendation with its item key, marker, normalized match terms and ready texts, sends them to the phone as deliveries, and pushes the user's devices. The iOS app claims deliveries and reports outcomes exactly as shared/CONTRACT.md says. The user can send any recommendation to the phone again from the web app.

Read first

- AGENTS.md, plan/README.md
- docs/product/reminders.md (the rules)
- docs/backend/pipeline.md (Workflow, Recommendations, Deliveries), docs/backend/push.md
- docs/backend/data-model.md: recommendations, deliveries, patterns, words, findings
- shared/CONTRACT.md: "Recommendations", "Text normalization", "Endpoints: recommendations and deliveries", "How the app applies a delivery", "Push notifications"
- shared/src/matching.ts (B02), worker/src/pipeline/ (B08), worker/src/push/notify.ts (B05)

Do

1. worker/src/recommendations/rank.ts: rankItems(result, knowledge) → the items of an analysis in delivery order (docs/product/reminders.md, "What goes to the phone"), each with its kind, item key, the recurring flag of its pattern, and whether it may go to the phone automatically (not a dismissed pattern, not a known or dismissed word). A pure function.
2. worker/src/recommendations/render.ts: for each item, the title and notes of a new MOZOL reminder and the embed line, from the item content and, for a mistake, the pattern's transcripts_count ("seen in N conversations"):
   - notes: plain text, "\n" line breaks, no trailing spaces;
   - embed line: one line, at most 200 characters; a longer line drops its optional parts in a fixed order written in the code and covered by tests;
   - priority: 1 for a high-severity mistake or a mistake of a recurring pattern, else 5;
   - all fixed wording from worker/src/copy.ts, written by the copy subagent (labels such as the ones before a wrong and a correct form). Learning content comes from the analysis as it is.
3. worker/src/recommendations/schedule.ts: the schedule given at claim time: due time at least 2 hours after now, moved into the active hours in the user's time zone, written as ISO 8601 with the user's UTC offset; the repeat rule by intensity (light: interval 3, count 3; normal: interval 1, count 5; intense: interval 1, count 10). Use Intl for time zones.
4. worker/src/recommendations/apply.ts: recommend(env, transcriptId), one D1 batch:
   - on a later run, delete the transcript's recommendations that have no delivery;
   - insert a recommendation for every ranked item whose item key has none in this transcript (marker and match terms through shared/src/matching.ts; content = the item as the model returned it);
   - add a pending delivery to every new recommendation that may go to the phone; a new pending delivery supersedes a pending (not claimed) delivery with the same marker;
   - set the transcript to analyzed (remove that from storeResult, B08).
   Returns the number of new deliveries and the user's number of pending deliveries.
5. Workflow: add step "recommend" (recommend(); retries { limit: 3, delay: "5 seconds" }) and step "notify" (notifyUser from B05 with the transcript id, title, pending count and the transcript id as collapse id; retries { limit: 3, delay: "1 minute" }; when it still fails, log it and finish without failing the transcript) after "store", both only for a result with status ok and notify only when new deliveries exist.
6. Routes (shared schemas validate bodies and, in tests, responses):
   - GET /api/recommendations (paged, newest first, filter delivered=true|false), GET /api/recommendations/:id (with its newest delivery).
   - POST /api/recommendations/:id/deliver: a new pending delivery (same supersede rule), notifyUser with the recommendation id as collapse id and transcriptId null; 202 { recommendation }.
   - POST /api/deliveries/claim: one UPDATE ... RETURNING statement as docs/backend/pipeline.md says; each claimed delivery gets its schedule (stored on the delivery) and is returned as a DeliveryItem; the response carries the user's embedInMyReminders. installationId must be a device of the current user (404 not_found).
   - POST /api/deliveries/results: the result rules of docs/backend/pipeline.md.
   - GET /api/transcripts/:id: recommendations of the transcript in rank order, each with its newest delivery.
7. Logs: recommendation and delivery counts, outcomes and error codes. Never titles, notes, lines or terms.

Checks

- rankItems tests: the order of docs/product/reminders.md with a mix of severities, a recurring pattern, words, rewrites and phrases; dismissed patterns and known or dismissed words are ranked but not sent.
- render tests: title, notes and embed line for each kind; no trailing spaces; an embed line that would pass 200 characters drops parts in the documented order; Russian explanations and English examples stay as given; priority rules.
- schedule tests: inside and outside active hours, a positive and a negative UTC offset, each intensity.
- recommend tests: the fixture result gives 14 recommendations (6 + 4 + 2 + 2) and 14 pending deliveries; a dismissed pattern and a known word get recommendations without deliveries; a second transcript with the same result gives recommendations with the same markers, and its new delivery supersedes a still-pending one with the same marker; a re-run keeps delivered recommendations, replaces undelivered ones and gives deliveries only to new ones.
- Delivery tests: claim gives a delivery to one installation only; a second installation gets nothing while the lease is live and gets it after the lease ends; at most one delivery per marker in one claim; an unknown installation gets 404; outcomes set applied; a late result after the lease is accepted when nobody claimed since and ignored when another installation did; three failed results end in failed; deliver adds a delivery and records pushes in push_log.
- Workflow test in fixture and log modes: a transcript ends analyzed with recommendations, a pending delivery for each, and two push_log rows per device.
- `pnpm --filter worker test`, `pnpm -r typecheck`, `pnpm lint`
- Local flow with curl: sign up, get an app token (app-code and app-token), PUT a device, post the Jamie fixture, claim (the deliveries with schedules and the embedInMyReminders flag), post outcomes (created, embedded), post the fixture again with a new metadata.id, claim again (the same markers for the same items), deliver one more recommendation from the first transcript, claim it. Show `SELECT kind, marker, rank FROM recommendations LIMIT 20` and `SELECT status, outcome, failures FROM deliveries`.

Out of scope

The iOS side. Web pages (W04, W06).

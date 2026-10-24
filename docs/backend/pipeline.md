Pipeline

What happens between an incoming transcript and a push. Tables: data-model.md. Model call: ai-analysis.md. Recommendation rules: ../product/reminders.md. Push: push.md.

Intake

The webhook request does only fast work and answers within a few seconds (Jamie waits 30 seconds at most).

1. Find the connection by the token in the URL. Unknown token, or a token of another source: 404 hook_not_found, nothing is stored.
2. From here on, every request gets a hook_events row with its outcome (refused for every error) and error code.
3. Paused connection: 403 hook_paused. Content type other than application/json: 415 unsupported_media_type. Body over 1,000,000 bytes: 413 payload_too_large, and the row keeps an empty body.
4. When the connection has a signing secret, the source adapter checks the signature on the raw body: 401 signature_invalid.
5. The adapter parses the body into a transcript, or answers "ignored" (200), or refuses it (400 bad_json, 422 payload_invalid). Segments that take more than 1,500,000 bytes as JSON are refused with 422 payload_invalid.
6. Insert the transcript. When (connection_id, external_id) exists: 200 duplicate with the existing transcript id.
7. Find the learner speaker with the rules of ../product/sources.md. Found: store it. Not found: learner_speaker_id stays null, and the workflow's speaker step chooses. Either way, start the analysis.
8. Answer 202 accepted with the transcript id.

Starting an analysis raises the transcript's run by one, sets status queued and creates the workflow instance. When creating the instance fails, the transcript becomes failed with error code internal, and the error is logged.

The paste endpoint (POST /api/transcripts) starts at step 5 with the paste adapter and writes no hook event.

Workflow

One Cloudflare Workflow, AnalyzeTranscript (binding ANALYZE, name analyze-transcript), analyzes one transcript. The instance id is "<transcript id>-<run>"; the parameters are { transcriptId, run }.

Every step reads what it needs from D1 and writes its result to D1 in one batch (a batch is one transaction). A step that runs twice leaves the same data as a step that ran once. Steps return only ids, counts and outcomes, never transcript text. An error that must not be retried is a NonRetryableError whose message starts with its error code and a colon ("analysis_refused: ...").

1. speaker: when the transcript's run is not this run, end. When learner_speaker_id is null, ask the model which speaker is the user (ai-analysis.md, "Choosing the learner"). When the call fails after its retries, or the answer is not one of the transcript's speaker ids, pick a speaker at random and log learner_random with the reason. Store learner_speaker_id and learner_word_count. Retries: 2, delay 10 seconds. This step never fails the transcript.
2. prepare: when the transcript's run is not this run, end. When the learner said fewer than 30 words: clear the transcript's results (as in store), status skipped with reason too_short, end. Otherwise status analyzing.
3. analyze: build the model input from D1 (ai-analysis.md), call the model, and write the analyses row (one per transcript; a new run replaces it). Retries: 4, first delay 30 seconds, exponential backoff, timeout 10 minutes per attempt. transcript_too_long, analysis_refused, analysis_truncated and analysis_invalid are not retried.
4. store: replace the transcript's findings, word suggestions and keywords with those of the new result; a result with a status other than ok has none, and the transcript becomes skipped with that status as the reason. Set the transcript's language. Insert missing patterns and words (by user, language and key). Recompute every pattern and word that the old or the new rows touched, and delete those with no rows left. A learned pattern that appears again becomes active.
5. recommend: make the recommendations and deliveries (below). The same batch sets the transcript to analyzed. Runs only after a result with status ok.
6. notify: when recommend created deliveries, push the user's devices (push.md). Retries: 3, delay 1 minute. When it still fails, it is logged; the transcript stays analyzed, and the app gets the deliveries on its next launch.

When a step fails for good, a last step sets the transcript to failed with the code from the error message (internal when there is none), unless a newer run took over.

Statuses

- received: stored, before the run starts.
- queued: a run was started. analyzing: the model is working.
- analyzed, skipped, failed: final until the user analyzes again.
- Analyze again: allowed in any status, except queued or analyzing that changed less than 30 minutes ago (transcript_busy).

Recommendations

The recommend step follows ../product/reminders.md.

- Every finding, word, phrase and rewrite of the result becomes a recommendation: item key, marker, normalized match terms, priority, the rendered title, notes and embed line (worker/src/recommendations/render.ts with fixed strings from worker/src/copy.ts), and the item itself as content.
- rank is the item's place in the delivery order. Every recommendation gets a pending delivery, except those of dismissed patterns and of words marked known or dismissed.
- A new pending delivery supersedes a pending (not claimed) delivery with the same marker.
- Analyzing again deletes the transcript's recommendations that never got a delivery, keeps the ones that did, and makes recommendations for items whose item key has none in this transcript. New deliveries go only to new recommendations.
- POST /api/recommendations/:id/deliver adds a pending delivery with the same supersede rule and pushes the devices.
- Rendering: the embed line is one line of at most 200 characters. A longer line drops its optional parts in a fixed order, documented in render.ts and covered by tests.

Deliveries

- Claim: one UPDATE ... RETURNING statement marks the deliveries it hands out, so two devices never get the same delivery. It takes the user's pending deliveries and the claimed ones whose lease ended, oldest first, at most one per marker, none for a marker with a live claimed delivery, at most the limit. Each gets claimed_by, claimed_until = now + 120 seconds, and a schedule, stored on the delivery and sent with it: earliestAt (claim time + 2 hours, UTC), the user's active hours and the repeat rule (../product/reminders.md). The worker knows no time zone; the app computes the due time in the phone's time zone.
- Results count only from the installation in claimed_by, while the delivery is claimed (also after its lease ended, when nobody else claimed it since).
  - An outcome (embed_updated, reminder_updated, embedded, created): status applied, outcome stored.
  - failed: failures + 1; back to pending below 3 failures, failed at 3.
- The worker never receives the user's reminders, their texts or identifiers.

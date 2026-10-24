B06 Sources, connections and intake

Track: backend. Depends on: B04. Runs at the same time as B05. Next: B08 (B07 can run before or in parallel).

Goal

Users connect sources and get webhook URLs. Jamie, the JSON webhook and pasted text turn into stored transcripts, with the user's speaker found by the rules or left for the model (B08). Each new transcript starts an AnalyzeTranscript workflow run (the workflow steps come in B08).

Read first

- AGENTS.md, plan/README.md
- docs/product/sources.md, docs/backend/sources/jamie.md, docs/backend/pipeline.md (Intake, Statuses)
- shared/CONTRACT.md: Source, Connection, HookEvent, Transcript, TranscriptDetail, JsonSourceBody, Errors, "Endpoints: sources and connections", "Endpoints: webhooks", "Endpoints: transcripts" (POST, GET list, GET one, speaker)
- docs/backend/data-model.md: connections, hook_events, transcripts
- shared/fixtures/jamie/, shared/fixtures/json/, shared/fixtures/paste/

Do

1. worker/src/sources/types.ts: NormalizedTranscript (external id, kind, title, occurred at, duration, language, participants with is_recorder, segments with speaker id, speaker name and text, an optional learner speaker hint) and the SourceAdapter interface: id, kind, webhook flag, setup steps, isPlaceholderName(name), optional verify(rawBody, headers, connection), parse(rawBody, headers) returning a transcript, "ignored", or an error code.
2. worker/src/sources/registry.ts with three adapters:
   - jamie.ts: the mapping and the signature check from docs/backend/sources/jamie.md (HMAC-SHA256 over "<t>.<raw body>", hex compare in constant time, t at most 2 hours old). Placeholder names: /^Speaker \d+$/i.
   - json.ts: JsonSourceBody from shared; speaker ids are made from speaker names; learnerSpeaker is the hint. No placeholder names.
   - paste.ts: the "Name: text" format and the kind rule from docs/product/sources.md. No placeholder names.
   The setup steps are user-facing strings: the copy subagent writes them in worker/src/copy.ts, following the Jamie steps in jamie.md.
3. worker/src/sources/learner.ts: findLearner(transcript, user, adapter) in the order of docs/product/sources.md ("Finding the user's turns"). Name matching ignores case, accents (Unicode NFD without marks) and extra spaces; a speaker name also matches the first word of a longer name; placeholder names never match. More than one speaker matching by name gives null. Returns the speaker id or null, and counts the learner's words.
4. worker/src/pipeline/start.ts: startAnalysis(env, transcriptId) raises run by one, sets status queued, and creates the workflow instance "<transcript id>-<run>" with params { transcriptId, run }. When creating the instance throws: status failed, error code internal, an error log line; the caller still answers normally. Add the workflow to wrangler.jsonc (name analyze-transcript, binding ANALYZE, class AnalyzeTranscript) and create worker/src/pipeline/workflow.ts with the AnalyzeTranscript class, exported from index.ts. Its run() throws a NonRetryableError with the message "internal: pipeline steps are added in step B08" until then.
5. Routes:
   - GET /api/sources (from the registry).
   - Connections: GET, POST (makes the hook token: 32 random bytes in base64url), PATCH (label, status, signingSecret), POST rotate, DELETE, GET events (newest 20). webhookUrl is APP_ORIGIN + "/api/hooks/<source>/<token>". Connections of another user answer 404.
   - POST /api/hooks/:source/:token: intake steps 1 to 8 of docs/backend/pipeline.md with the exact answers of the contract. Every request with a known token gets a hook_events row, also the refused ones. Rate limit HOOK_LIMITER: 60 per minute per token. Update the connection's last_event_* columns on every event.
   - POST /api/transcripts (paste), GET /api/transcripts (paged by occurredAt), GET /api/transcripts/:id (segments; analysis null and reminders [] until B08 and B09). There is no speaker endpoint: the user never chooses a speaker.
6. Logs: one line per hook event with rid, connection id, outcome, error code and size. Never the body.

Checks

- Tests:
  - the Jamie fixture gives 202 accepted, a transcript with all segments, and the learner found through the recorder email; status queued and a workflow instance created;
  - the same delivery again gives 200 duplicate with the same transcript id;
  - with a signing secret: a valid signature passes; a wrong one, a missing one and one older than 2 hours give 401 signature_invalid;
  - a paused connection gives 403 hook_paused; an unknown token or a token of another source gives 404 hook_not_found and no hook event; more than 1,000,000 bytes gives 413 with an empty stored body; another content type gives 415; broken JSON gives 400 bad_json; a body without a transcript gives 422 payload_invalid; segments over 1,500,000 bytes as JSON give 422; every refused request with a known token has a hook_events row with outcome refused and its error code;
  - the unknown-speakers fixture is queued with learner_speaker_id null (the model chooses in B08); a speaker named "Speaker 2" is never matched by name;
  - two speakers that both match one of the user's names give learner_speaker_id null;
  - the paste fixture (kind call) and a paste without names (kind text, the user is the only speaker); the json fixture with learnerSpeaker;
  - a failing workflow create (stub the binding) leaves the transcript failed with internal and still answers 202;
  - connections: create, rename, pause, rotate (the old URL then gives 404), delete (transcripts keep connectionId null), events list;
  - findLearner unit tests for each rule, accents, first-name matching and placeholder names.
- `pnpm --filter worker test`, `pnpm -r typecheck`, `pnpm lint`
- Local flow with curl against `scripts/start-all.sh --no-app`: create a Jamie connection, post shared/fixtures/jamie/meeting-completed.json to its webhook URL (change data.user.email to the signed-up email first), post it again, then query the local D1: `SELECT outcome, error_code FROM hook_events`, `SELECT status, learner_speaker_id, run, error_code FROM transcripts`.

Out of scope

The analysis and the workflow steps (B07, B08). Web pages (W03).

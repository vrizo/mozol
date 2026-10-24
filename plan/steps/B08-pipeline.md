B08 Pipeline workflow, patterns and words

Track: backend. Depends on: B06, B07. Next: B09. W04 and W05 depend on this step.

Goal

Each queued transcript is analyzed by the AnalyzeTranscript workflow: speaker, prepare, analyze, store. Results become findings, word suggestions, keywords and the user's patterns and words, with correct counts after every run, re-run, skip and delete. The web app can read and change patterns and words.

Read first

- AGENTS.md, plan/README.md
- docs/backend/pipeline.md (Workflow, Statuses), docs/backend/ai-analysis.md, docs/product/analysis.md (Patterns, Words, Keywords, Skipped transcripts)
- docs/backend/data-model.md: conventions (item key), transcripts, analyses, findings, word_suggestions, keywords, patterns, words
- shared/CONTRACT.md: Transcript, TranscriptDetail, Analysis, Pattern, Word, "Endpoints: transcripts" (analyze, delete), "Endpoints: patterns and words"
- worker/src/pipeline/ (start.ts, workflow.ts from B06), worker/src/analysis/ (B07)
- Workflows docs through Context7: WorkflowEntrypoint, step.do options, NonRetryableError, and testing with @cloudflare/vitest-plugin (introspectWorkflowInstance, mockStepResult, mockStepError, disableRetryDelays).

Do

0. worker/src/analysis/speaker.ts and worker/src/pipeline/speaker.ts: the speaker step of docs/backend/pipeline.md and "Choosing the learner" in docs/backend/ai-analysis.md. chooseLearner(env, transcriptId, run): "stale" when the run changed; "kept" when learner_speaker_id is set; otherwise one model call with a speakerId enum of the transcript's speaker ids, and a random speaker (random source injected for tests) when the call fails or the answer is invalid. Stores learner_speaker_id and learner_word_count. Never fails the transcript. Fixture mode picks at random.
1. worker/src/pipeline/prepare.ts: prepareRun(env, transcriptId, run) returns only an outcome: "stale" when the transcript's run is not this run; "skipped" below 30 learner words (it clears the transcript's results with clearResults and sets status skipped, reason too_short); otherwise "ready" after setting status analyzing.
2. worker/src/pipeline/analyze.ts: runAnalysis(env, transcriptId, run): loads the transcript, the user, up to 50 active known patterns in any language (newest last_seen_at first) and the newest estimatedLevel per language from the user's analyses, builds the input with buildModelInput (B07; transcript_too_long is thrown here), calls createModel(env).analyze, and writes the analyses row (insert or replace by transcript_id, with model, prompt version, language, tokens, duration, unmatched quotes). Returns the analysis id and status only.
3. worker/src/pipeline/store.ts:
   - clearResults(env, transcriptId): deletes the transcript's findings, word suggestions and keywords and recomputes what they touched (below).
   - storeResult(env, transcriptId): reads the transcript's analysis. Status other than ok: clearResults, transcript skipped with that status as the reason. Status ok, in one D1 batch: remember the pattern and word ids of the old rows; delete the transcript's findings, word suggestions and keywords; set the transcript's language; insert missing patterns (by user, language and key) and words (by user, language and word key, the normalized term); insert findings and word suggestions with normalized match terms; insert keywords (one row per match term of every item: findings, words, phrases and rewrites, with item keys as shared/CONTRACT.md defines them); recompute occurrences_total, transcripts_count, sources, first_seen_at, last_seen_at, title and match terms of every touched pattern, and times_suggested, first_seen_at, last_seen_at and the newest content of every touched word; delete touched patterns and words that have no rows left; set a learned pattern that appears again back to active.
   - Until B09 adds the recommend step, storeResult also sets the transcript to analyzed with analyzed_at. B09 moves that into the recommend batch.
   - Respect the D1 limit of 100 bound parameters per statement. Report the largest batch (number of statements) you measured with the fixture.
   - Running storeResult twice gives the same rows.
4. worker/src/pipeline/workflow.ts: replace the B06 placeholder. Steps:
   - "speaker": chooseLearner; end on stale. Retries { limit: 2, delay: "10 seconds" }.
   - "prepare": prepareRun; end on stale or skipped.
   - "analyze": runAnalysis. Retries { limit: 4, delay: "30 seconds", backoff: "exponential" }, timeout "10 minutes". A non-retryable analysis error becomes a NonRetryableError whose message starts with the code and a colon.
   - "store": storeResult.
   - The workflow ends here in this step; B09 adds "recommend" and "notify".
   - When a step fails for good, a final step sets the transcript to failed with the code taken from the error message (internal when the message has no known code), unless the transcript's run changed. Log every step's end with transcript id, run, step, duration and outcome.
5. Routes:
   - POST /api/transcripts/:id/analyze: 409 transcript_busy while queued or analyzing and changed less than 30 minutes ago; otherwise startAnalysis; 202 { transcript }.
   - DELETE /api/transcripts/:id: clearResults, then delete the transcript; 204.
   - GET /api/transcripts/:id now includes language, analysis and counts (findings, words, phrases, rewrites); recommendations stay [] until B09.
   - GET /api/patterns (filters status and language; recurring first, then last_seen_at), PATCH /api/patterns/:id. Pattern.latest comes from the newest finding of that pattern.
   - GET /api/words (filters status and language; newest last_seen_at first), PATCH /api/words/:id.

Checks

- Tests:
  - storeResult with result-ok.json: rows in findings, word_suggestions, keywords, patterns, words; counts right; a second call changes nothing; a second transcript with the same result makes the patterns recurring (transcripts_count 2); a re-run with a different result removes the old findings, fixes the counts and deletes patterns that lost their last finding; a re-run that ends native_language clears the transcript's findings and fixes the counts; a result in German (made in the test) creates patterns and words under language de, apart from the English ones; delete fixes the counts.
  - chooseLearner: a learner already set is kept; the model's valid answer is stored; an answer that is not a speaker id, and a failed call, give a random speaker (fixed random source); the unknown-speakers Jamie fixture always ends with a learner.
  - prepareRun: too_short skip clears earlier results; a stale run ends.
  - The workflow in fixture mode: a queued transcript ends analyzed (introspection, status complete). With the analyze step failing with a retryable error until retries run out: status failed, analysis_failed. With analysis_refused: no retries, status failed with analysis_refused. A result with status native_language: status skipped, reason native_language.
  - The endpoints: analyze again (409 while busy, allowed after 30 minutes), delete, patterns and words lists and PATCH; responses parse with the shared schemas.
- `pnpm --filter worker test`, `pnpm -r typecheck`, `pnpm lint`
- Local flow against `scripts/start-all.sh --no-app` (fixture mode): sign up, create a Jamie connection, post the Jamie fixture (with your email as data.user.email); within 10 seconds GET /api/transcripts/:id shows status analyzed and the analysis. Post it again with a different metadata.id. Then in the local D1: `SELECT key, occurrences_total, transcripts_count FROM patterns`, `SELECT COUNT(*) FROM keywords`, `SELECT status, run FROM transcripts`.

Out of scope

Reminders and pushes (B09).

W04 Activity and transcript

Track: web. Depends on: W02, B08 (B09 for the recommendations block). Next: W05.

Goal

The user sees every transcript and its status, answers "Which speaker are you?", reads an analysis (summary, findings, words, phrases, rewrites) and sends recommendations to the phone.

Read first

- AGENTS.md, plan/README.md
- docs/product/web-app.md (Activity, Transcript), docs/product/analysis.md, docs/product/sources.md (Finding the user's turns), docs/rules/ui-copy.md
- shared/CONTRACT.md: Transcript, TranscriptDetail, Analysis, AnalysisResult, Recommendation, "Endpoints: transcripts", POST /api/recommendations/:id/deliver
- web/src/ from W01 to W03

Do

1. Activity (/activity): transcripts, newest first, paged with a "load more" button. Each row: title (or a placeholder for none), source, date, duration, status. Skipped rows show the reason; failed rows the error code. While any row is queued or analyzing, refresh every 5 seconds; stop when none is.
2. needs_speaker rows show the speaker choice inline: each speaker with word count and first lines (from GET /api/transcripts/:id), a button per speaker (POST .../speaker), then the row shows queued.
3. Transcript (/activity/:id):
   - header: title, source, date, duration, conversation language, status, the learner speaker;
   - summary: overview, estimated level, strengths, focus (native-language texts; set lang attributes from the user's native language and the conversation language so screen readers read them right);
   - findings grouped by category, high severity first: title, severity, occurrences, examples (quote and correction, visually distinct and readable by screen readers as "you said" and "better"), explanation, tip;
   - words: term, type, translation, meaning, example and its translation, what the user said instead;
   - phrases: phrase, when to use it, translation, the user's version;
   - rewrites: the user's sentence and the better version side by side, with the note;
   - recommendations block: every recommendation of this transcript in rank order with its delivery state (waiting, on the phone with its outcome, failed, not sent), a link to /r/<id>, and "send to phone" for one without a waiting delivery (empty until B09);
   - the transcript itself, collapsed by default, with the learner's lines marked;
   - actions: analyze again (POST analyze; disabled while busy; 409 transcript_busy shown as a notice), change speaker (the same choice as above), delete (confirm dialog, then back to /activity).
   - queued and analyzing states refresh every 5 seconds; skipped and failed states explain the reason or code and offer analyze again.
4. Strings in web/src/copy/en.ts by the copy subagent. Category, severity and status names are copy too.

Checks

- vitest for pure helpers: grouping and ordering findings, the "is anything busy" check that drives refreshing, duration formatting, delivery state texts.
- `pnpm --filter web test`, `pnpm --filter web build`, `pnpm lint`
- Browser against the local stack in fixture mode: post the Jamie fixture (your email as data.user.email) and watch the row go from queued to analyzed without a reload; open it and check every block; post shared/fixtures/jamie/meeting-completed-unknown-speakers.json and pick a speaker inline; send a recommendation to the phone again; analyze again; delete. 360 px and 1280 px; keyboard through the speaker choice. Screenshots to tests/screenshots/<date>/. Close your tabs.

Out of scope

Patterns and words pages (W05), reminder pages (W06).

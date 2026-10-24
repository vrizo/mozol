W04 Activity and transcript

Track: web. Depends on: W02, B08 (B09 for the recommendations block). Next: W05.

Goal

The user sees the new recommendations that MOZOL puts into Reminders, reads an analysis (summary, findings, words, phrases, rewrites) and sends recommendations to the phone. The user never chooses a speaker.

Read first

- AGENTS.md, plan/README.md
- docs/product/web-app.md (Activity, Transcript), docs/product/analysis.md, docs/product/sources.md (Finding the user's turns), docs/rules/ui-copy.md
- shared/CONTRACT.md: Transcript, TranscriptDetail, Analysis, AnalysisResult, Recommendation, "Endpoints: transcripts", POST /api/recommendations/:id/deliver
- web/src/ from W01 to W03

Do

1. Activity (/activity): only recommendations sent to the phone (GET /api/recommendations?delivered=true), newest first, paged with a "load more" button. Each row: title linking to /r/<id>, kind, language, delivery state, date.
2. Transcript (/activity/:id):
   - header: title, source, date, duration, conversation language, status, the learner speaker;
   - summary: overview, estimated level, strengths, focus (native-language texts; set lang attributes from the user's native language and the conversation language so screen readers read them right);
   - findings grouped by category, high severity first: title, severity, occurrences, examples (quote and correction, visually distinct and readable by screen readers as "you said" and "better"), explanation, tip;
   - words: term, type, translation, meaning, example and its translation, what the user said instead;
   - phrases: phrase, when to use it, translation, the user's version;
   - rewrites: the user's sentence and the better version side by side, with the note;
   - recommendations block: every recommendation of this transcript in rank order with its delivery state (waiting, on the phone with its outcome, failed, not sent), a link to /r/<id>, and "send to phone" for one without a waiting delivery (empty until B09);
   - the transcript itself, collapsed by default, with the learner's lines marked;
   - actions: analyze again (POST analyze; disabled while busy; 409 transcript_busy shown as a notice), delete (confirm dialog, then back to /activity).
   - queued and analyzing states refresh every 5 seconds; skipped and failed states explain the reason or code and offer analyze again.
3. Strings in web/src/copy/en.ts by the copy subagent. Category, severity and status names are copy too.

Checks

- vitest for pure helpers: grouping and ordering findings, the "is anything busy" check that drives refreshing, duration formatting, delivery state texts.
- `pnpm --filter web test`, `pnpm --filter web build`, `pnpm lint`
- Browser against the local stack in fixture mode: post the Jamie fixture (your email as data.user.email), see its recommendations appear in Activity, open its transcript and check every block; post shared/fixtures/jamie/meeting-completed-unknown-speakers.json and check that it is analyzed without any question; send a recommendation to the phone again; analyze again; delete. 360 px and 1280 px; Screenshots to tests/screenshots/<date>/. Close your tabs.

Out of scope

Patterns and words pages (W05), reminder pages (W06).

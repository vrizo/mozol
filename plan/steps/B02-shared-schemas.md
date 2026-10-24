B02 Shared schemas, text matching and fixtures

Track: backend. Depends on: B01, and Vitalii's review of shared/CONTRACT.md. Next: B03 (B07 and W01 can start too).

Goal

Every type, request body and response of shared/CONTRACT.md exists as a zod schema in shared/src/, with TypeScript types inferred from it. The text normalization, match terms, item keys and markers are implemented once in shared/ and tested with cases the iOS app uses too. shared/fixtures/ holds realistic sample data for the worker tests, the web app and the iOS app.

Read first

- AGENTS.md, plan/README.md
- shared/CONTRACT.md (all of it)
- docs/product/analysis.md, docs/product/reminders.md, docs/product/sources.md, docs/backend/sources/jamie.md

Do

1. Schemas in shared/src/, one module per area, all exported from src/index.ts:
   - common.ts: Id, Time, LanguageCode, Level, SourceId, SourceKind, the error code list, ErrorBody (with optional issues), a helper for paged responses.
   - accounts.ts: User, ReminderSettings (only embedInMyReminders), the bodies and responses of every /api/auth and /api/me endpoint.
   - sources.ts: Source, Connection, HookOutcome, HookEvent, connection bodies, the webhook responses, JsonSourceBody.
   - transcripts.ts: TranscriptStatus, Transcript, TranscriptDetail, Analysis, the paste body.
   - analysis.ts: Category, MatchTerm, Finding, WordSuggestion, Phrase, Rewrite, AnalysisResult, PATTERN_KEY (the regular expression from the contract) and the per-item limits (1 to 3 examples, 0 to 8 match terms, 1 to 8 for words, title at most 60 characters). The lists have no maximum length. Refinements: a finding's category equals the first part of its patternKey; patternKey values are unique in one result; word keys are unique in one result; the match term rules of the contract.
   - knowledge.ts: Pattern, Word, their PATCH bodies, the list queries (status, language).
   - devices.ts: RemindersAccess, Device, PutDeviceBody (apnsEnvironment is null exactly when apnsToken is null).
   - recommendations.ts: RecommendationKind, Recommendation, Delivery, DeliveryOutcome, DeliveryItem, DeliveryResult, the claim and results bodies (with their size limits) and responses.
   - push.ts: the deliveries push and the test push payloads (both silent).
   Schemas follow the contract exactly: same field names, nullability, enums and limits. Request bodies are strict objects (unknown keys fail). Response schemas are strict too, so a worker that sends a wrong field fails its tests.
2. shared/src/matching.ts, used by the worker (and by the web app for display), the reference for the iOS app:
   - normalizeText(text): the five steps of "Text normalization" in the contract.
   - tokens(normalized), termMatches(term, normalizedText), scoreText(terms, text) (the number of matching terms; the caller passes the text without the lines MOZOL added).
   - normalizeTerm(term): the term text normalized; a term that becomes empty or breaks the mode rules is an error.
   - itemKey(kind, item) and marker(language, itemKey) as the contract defines them: 8 lowercase hex characters (SHA-256 through crypto.subtle, async).
3. zod version: the worker passes AnalysisResult to zodOutputFormat from @anthropic-ai/sdk/helpers/zod in B07. The SDK accepts zod ^3.25 or ^4; use zod 4. Keep the refinements in a way that zodOutputFormat accepts (it sends the plain JSON Schema to the model and checks the rest after the call); if it cannot take a refined schema, export the plain object schema and the refined one separately, and say so in the report.
4. Fixtures in shared/fixtures/. Write all content yourself; do not copy text from Jamie's documentation.
   - jamie/meeting-completed.json: a Jamie meeting.completed body with every field from docs/backend/sources/jamie.md. A product meeting in English of about 40 turns with 3 speakers. The recorder (data.user.email equals his participant email) is "Petr Ivanov", a Russian native speaker at B1 to B2 level. His turns contain typical mistakes: missing and wrong articles, "I am agree", "explain me", present perfect with a past time ("I have seen it yesterday"), "actual" meaning "current", "do a decision", overuse of "very", one swear word in a tense moment, one outdated term for a group of people, and two long clumsy sentences. The two other speakers are native speakers without mistakes.
   - jamie/meeting-completed-unknown-speakers.json: the same shape; speakers named "Speaker 1" and "Speaker 2", participants without emails, data.user.email matching nobody.
   - jamie/meeting-completed-german.json: a short meeting in German where Petr makes typical mistakes (cases, word order, gender).
   - json/transcript.json: a JsonSourceBody with learnerSpeaker set.
   - paste/transcript.txt: a pasted transcript in "Name: text" lines, with one line that continues the previous turn.
   - analysis/result-ok.json: an AnalysisResult that fits jamie/meeting-completed.json: status ok, language en, 6 findings (including a register finding for the swear word and one for the outdated term), 4 words, 2 phrases, 2 rewrites; explanations, titles, tips, translations and the summary in Russian; quotes are exact fragments of Petr's lines; match terms in English and Russian with all four modes used somewhere.
   - analysis/result-native-language.json: status native_language with empty lists.
   - matching/cases.json: at least 25 cases { text, terms, expectedScore, note } covering each mode, Russian inflections with prefix terms, German umlauts and ß, accents, punctuation, a phrase across a line break, "ё", and Chinese text with substring terms. The iOS app runs the same cases.
   - deliveries/claim-response.json: a claim response with two DeliveryItems (a word and a mistake), markers computed with marker().
   - push/deliveries.json, push/test.json.
5. Tests in shared/test/ (vitest, node environment; add vitest and a test script to shared): every fixture parses with its schema; result-ok quotes appear in Petr's lines of the Jamie fixture; matching/cases.json passes; marker() gives the same marker for the same language and item key and a different one for another language; failing cases are refused: a bad pattern key, a category that differs from the key's first part, two findings with one key, two words with one word key, a prefix term shorter than 4 characters, a word term with a space, 4 examples in one finding, an apnsToken with a null apnsEnvironment, an unknown key in a request body.

Checks

- `pnpm --filter shared test`
- `pnpm -r typecheck`, `pnpm lint`
- `pnpm --filter worker test` still passes.

Out of scope

Worker routes and tables. Changing the contract: if something in it looks wrong or impossible, list it in the report instead.

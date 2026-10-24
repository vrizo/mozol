MOZOL API contract

Version 1. The source of truth for the worker, the web app and the iOS app. The zod schemas in shared/src/ follow this file exactly; the iOS app follows it by hand and is tested against shared/fixtures/. A change here is agreed by both developers before code changes.

Conventions

- Base URL: https://mozol.vrizo.net, API under /api. Local development: http://localhost:5190 serves the web pages and passes /api to the worker on http://localhost:8790. The iOS app uses one base URL for pages and API: http://localhost:5190 locally; with scripts/stub-api.mjs in place of the worker, http://localhost:8790 (docs/ios/testing.md).
- Bodies are JSON in UTF-8, field names in camelCase. A field shown as `T | null` is always present; a field marked optional (`?`) may be missing.
- Times are ISO 8601 UTC strings with milliseconds ("2026-10-24T12:00:00.000Z"), unless a field says otherwise.
- Ids are opaque strings with a type prefix ("usr_01JB8Z6Q4M2V7N3K5D9X1C0F8T"). Clients never parse them.
- Every request may carry X-Request-Id (12 lowercase hex characters, new per request). The response carries the same header; the worker makes one when the request has none.
- Lists that can grow are paged: `?limit=<1..100, default 20>&cursor=<from nextCursor>`; the answer is `{ items: T[], nextCursor: string | null }`.
- Languages are BCP 47 primary tags (2 or 3 lowercase letters: "en", "de", "ru"). Any language is allowed.
- The worker sends no CORS headers.

Authentication

- Web: the cookie mozol_session (HttpOnly, Secure, SameSite=Lax, Path=/), set by sign-up and sign-in.
- iOS app: `Authorization: Bearer <app session token>`.
- A request with the cookie and a method other than GET must carry an Origin header equal to the site origin (https://mozol.vrizo.net; http://localhost:5190 locally), otherwise 403 forbidden. Bearer requests and webhooks skip this check.
- A resource of another user answers 404 not_found.

Sign-in handoff

1. The app opens `<base>/app/signin?return=mozol://auth` in a WKWebView inside the app, not in the system browser. Its navigation delegate catches the navigation to mozol://auth, cancels it, takes the code and closes the web view.
2. After sign-up or sign-in the page calls POST /api/auth/app-code and navigates to `mozol://auth?code=<code>`. It accepts only return addresses that start with mozol://.
3. Within 2 minutes the app calls POST /api/auth/app-token with the code and its installationId, and keeps the token in the Keychain.
4. The app registers its device: PUT /api/devices/:installationId.

Errors

Every error is an HTTP status with the body `{ "error": "<code>" }`. validation_failed adds `"issues": [{ "path": "email", "code": "invalid_format" }]` (path joined with dots, code from zod).

| Status | Code | When |
|---|---|---|
| 400 | bad_json | the body is not valid JSON |
| 400 | validation_failed | the body or the query does not match the schema |
| 400 | code_invalid | an app sign-in code is unknown, used or expired |
| 401 | unauthorized | no session, or the session expired |
| 401 | invalid_credentials | wrong email or password |
| 401 | signature_invalid | a webhook signature is missing, wrong or too old |
| 403 | forbidden | a cookie request without the right Origin; app-code with an app session |
| 403 | hook_paused | the connection is paused |
| 404 | not_found | no such resource for this user, or an installationId that is not a device of this user |
| 404 | hook_not_found | unknown webhook token, or the token belongs to another source |
| 409 | email_taken | sign-up with an email that has an account |
| 409 | transcript_busy | analyze again while the transcript is queued or analyzing |
| 413 | payload_too_large | a webhook body over 1,000,000 bytes |
| 415 | unsupported_media_type | a webhook body that is not application/json |
| 422 | payload_invalid | a webhook body the source adapter cannot read, or a transcript too large to store |
| 429 | rate_limited | too many requests; the Retry-After header says when to retry |
| 500 | internal | an unexpected worker error |
| 503 | push_not_configured | a test push while the worker has no APNs key |

Transcript error codes (Transcript.errorCode): analysis_failed, analysis_refused, analysis_truncated, analysis_invalid, transcript_too_long, internal. Skip reasons (Transcript.skipReason): too_short, too_little_speech, native_language.

Types

```ts
type Id = string;
type Time = string;
type LanguageCode = string;            // BCP 47 primary tag, 2 or 3 lowercase letters
type SourceId = "jamie" | "paste" | "json";
type SourceKind = "call" | "chat" | "text";

type User = {
  id: Id;
  email: string;
  displayName: string;                 // 1..80 characters
  nativeLanguage: LanguageCode;
  speakerNames: string[];              // "Your names" in the UI: 0..10 names, 1..80 characters each
  reminderSettings: ReminderSettings;
  createdAt: Time;
};

type ReminderSettings = {
  embedInMyReminders: boolean;         // default true: the app may add recommendations to the user's own reminders
  intensity: "light" | "normal" | "intense";   // repeat rule of new MOZOL reminders
  activeFrom: string;                  // "HH:MM", in the phone's current time zone
  activeTo: string;                    // "HH:MM", later than activeFrom
};

type Source = {
  id: SourceId;
  name: string;
  kind: SourceKind;                    // paste: "text"
  webhook: boolean;                    // false for paste
  setupSteps: string[];                // shown on the connect screen
};

type Connection = {
  id: Id;
  source: "jamie" | "json";
  label: string;                       // 1..80 characters
  status: "active" | "paused";
  webhookUrl: string;                  // <base>/api/hooks/<source>/<token>
  hasSigningSecret: boolean;
  lastEventAt: Time | null;
  lastEventOutcome: HookOutcome | null;
  lastEventError: string | null;
  createdAt: Time;
};

type HookOutcome = "accepted" | "duplicate" | "ignored" | "refused";

type HookEvent = {
  id: Id;
  receivedAt: Time;
  outcome: HookOutcome;
  errorCode: string | null;
  sizeBytes: number;
  transcriptId: Id | null;
};

type TranscriptStatus =
  "received" | "queued" | "analyzing" | "analyzed" | "skipped" | "failed";

type Transcript = {
  id: Id;
  source: SourceId;
  connectionId: Id | null;             // null for paste and for a deleted connection
  kind: SourceKind;
  title: string | null;
  occurredAt: Time;
  durationSec: number | null;
  language: LanguageCode | null;       // the conversation language found by the analysis
  status: TranscriptStatus;
  skipReason: string | null;
  errorCode: string | null;
  learnerSpeakerName: string | null;   // null until the learner is chosen (docs/product/sources.md)
  counts: { findings: number; words: number } | null;   // null until analyzed
  createdAt: Time;
};

type TranscriptDetail = Transcript & {
  segments: { speakerId: string; speakerName: string; text: string }[];
  analysis: Analysis | null;
  recommendations: Recommendation[];   // in delivery order
};

type Analysis = {
  id: Id;
  model: string;
  promptVersion: string;
  createdAt: Time;
  result: AnalysisResult;
};

type Pattern = {
  id: Id;
  language: LanguageCode;
  key: string;
  category: Category;
  title: string;
  status: "active" | "learned" | "dismissed";
  recurring: boolean;                  // seen in 2 or more transcripts
  occurrencesTotal: number;
  transcriptsCount: number;
  sources: SourceId[];
  firstSeenAt: Time;
  lastSeenAt: Time;
  latest: Pick<Finding, "examples" | "explanation" | "tip">;
};

type Word = {
  id: Id;
  language: LanguageCode;
  term: string;
  type: WordSuggestion["type"];
  translation: string;
  meaning: string;
  example: string;
  exampleTranslation: string;
  status: "new" | "learning" | "known" | "dismissed";   // new: not reviewed; learning: the user learns it
  timesSuggested: number;
  firstSeenAt: Time;
  lastSeenAt: Time;
};

type RemindersAccess = "full" | "write_only" | "denied" | "restricted" | "not_determined";

type Device = {
  id: Id;
  installationId: string;
  platform: "ios";
  appVersion: string | null;
  osVersion: string | null;
  pushEnabled: boolean;                // has an APNs token that APNs did not reject
  remindersAccess: RemindersAccess;
  lastSeenAt: Time;
};
```

Analysis result

The model returns this object (structured output). Limits and rules that JSON Schema cannot express are checked by zod after the call; a result that breaks them fails with analysis_invalid. Texts marked "native" are in the user's native language; texts marked "conversation" are in the language the learner speaks in this transcript. One result holds at most 3 findings and 3 words (docs/product/analysis.md).

```ts
type Category = "grammar" | "vocabulary" | "phrasing" | "register" | "fluency" | "spelling" | "punctuation";

type MatchTerm = {
  text: string;                        // 1..60 characters
  lang: LanguageCode;                  // the conversation language or the native language
  mode: "word" | "prefix" | "phrase" | "substring";
};

type AnalysisResult = {
  status: "ok" | "too_little_speech" | "native_language";
  language: LanguageCode | null;       // the language the learner mostly speaks here; null only with too_little_speech
  findings: Finding[];                 // 0..3, most important first; [] when status is not ok
  words: WordSuggestion[];             // 0..3, most important first; [] when status is not ok
};

type Finding = {
  patternKey: string;                  // /^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/, at most 64 characters
  category: Category;                  // equals the first part of patternKey
  title: string;                       // native, at most 60 characters
  severity: "low" | "medium" | "high";
  occurrences: number;                 // 1 or more, in this transcript
  examples: { quote: string; correction: string }[];   // conversation, 1..3; quote is the learner's exact words
  explanation: string;                 // native, 1-2 short sentences
  tip: string | null;                  // native
  matchTerms: MatchTerm[];             // 1..8
};

type WordSuggestion = {
  term: string;                        // conversation
  type: "word" | "phrasal_verb" | "collocation" | "idiom" | "phrase";
  reason: "misused" | "better_choice" | "overused_alternative" | "missing_word";
  learnerSaid: string | null;          // conversation
  translation: string;                 // native
  meaning: string;                     // native: when and how to use it
  example: string;                     // conversation
  exampleTranslation: string;          // native
  matchTerms: MatchTerm[];             // 1..8
};

```

Rules:
- patternKey values are unique within one result; word keys (the term after normalization, below) are unique within one result.
- Match terms: word and prefix terms have no spaces; prefix terms have at least 4 characters; phrase terms have at least 2 words; the worker normalizes every term (below) before storing and sending it.

Recommendations

Every item of an analysis (finding or word) becomes one recommendation, and every recommendation goes to the phone, except those of dismissed patterns and of words marked known or dismissed. On the phone one recommendation becomes one reminder: the app adds it to a reminder of the user that mentions it, or creates a new reminder in the user's default list. Rules: docs/product/reminders.md.

```ts
type RecommendationKind = "mistake" | "word";

type Recommendation = {
  id: Id;
  transcriptId: Id | null;             // null after that transcript was deleted
  language: LanguageCode;              // the conversation language
  kind: RecommendationKind;
  itemKey: string;                     // the same mistake or word has the same key in every transcript
  marker: string;                      // 8 lowercase hex characters; the app keeps it hidden in what it writes (docs/ios/reminders.md)
  title: string;                       // title of a new MOZOL reminder
  notes: string;                       // notes of a new MOZOL reminder
  embedLine: string;                   // one line for the user's own reminder, at most 200 characters
  matchTerms: MatchTerm[];             // normalized
  url: string;                         // <base>/r/<id>
  priority: 1 | 5;                     // EventKit scale: 1 high, 5 medium
  delivery: Delivery | null;           // the newest delivery to the phone
  createdAt: Time;
};

type Delivery = {
  id: Id;
  status: "pending" | "claimed" | "applied" | "failed" | "superseded";
  outcome: DeliveryOutcome | null;     // set when applied
  errorCode: string | null;
  updatedAt: Time;
};

type DeliveryOutcome = "embed_updated" | "reminder_updated" | "embedded" | "created";

type Repeat = { frequency: "daily"; interval: number; count: number };   // every <interval> days, <count> times
```

- itemKey: the pattern key for a mistake; "word:" + the normalized term for a word.
- marker: the first 8 hex characters of SHA-256 of "<language>:<itemKey>". The same item in the same language always has the same marker. The app attaches it, hidden from the user, to every reminder it creates and every line it adds, and finds earlier placements by it. The hidden marker travels with the reminder through iCloud, so every device of the user finds it. How the app hides it: docs/ios/reminders.md.

Text normalization

The worker and the app normalize text the same way, so matching gives the same answer on both sides. shared/fixtures/matching/cases.json holds test cases for both.

1. Lowercase (Unicode default case mapping, no locale).
2. Unicode NFKD.
3. Remove every character of the Unicode category Mn (nonspacing marks).
4. Replace every run of characters that are not letters (L) or numbers (N) with one space.
5. Trim spaces at both ends.

Tokens are the normalized text split at spaces. A term matches a text when, after both are normalized:
- word: one token equals the term;
- prefix: one token starts with the term;
- phrase: the term's tokens appear in the text as consecutive tokens;
- substring: the text contains the term (for languages written without spaces).

Endpoints: health

- GET /api/health → 200 `{ "ok": true }`. No session.

Endpoints: accounts

- POST /api/auth/sign-up `{ email, password, displayName, nativeLanguage }` → 201 `{ user: User }` and the session cookie. Password 10..200 characters. Errors: validation_failed, email_taken, rate_limited.
- POST /api/auth/sign-in `{ email, password }` → 200 `{ user: User }` and the session cookie. Errors: invalid_credentials, rate_limited.
- POST /api/auth/sign-out → 204. Ends the current session (cookie or bearer) and clears the cookie.
- POST /api/auth/app-code (web session) → 201 `{ code: string, expiresAt: Time }`. The code is 32 random bytes in base64url, valid once, for 2 minutes. Errors: forbidden for an app session.
- POST /api/auth/app-token `{ code, installationId }` (no session) → 201 `{ token: string, user: User }`. installationId: 8..64 characters of letters, digits, "-" and "_", made by the app once per install and kept in the Keychain. Errors: code_invalid, rate_limited.
- GET /api/me → 200 `{ user: User }`.
- PATCH /api/me `{ displayName?, nativeLanguage?, speakerNames?, reminderSettings? }` → 200 `{ user: User }`. reminderSettings is sent whole.
- DELETE /api/me `{ password }` → 204. Deletes the account and all its data. Errors: invalid_credentials.

Endpoints: sources and connections

- GET /api/sources → 200 `{ sources: Source[] }`.
- GET /api/connections → 200 `{ connections: Connection[] }`.
- POST /api/connections `{ source: "jamie" | "json", label? }` → 201 `{ connection: Connection }`.
- PATCH /api/connections/:id `{ label?, status?, signingSecret? }` → 200 `{ connection: Connection }`. signingSecret: a string of 1..200 characters sets it, null removes it.
- POST /api/connections/:id/rotate → 200 `{ connection: Connection }` with a new webhookUrl. The old URL answers 404 hook_not_found from now on.
- DELETE /api/connections/:id → 204. Transcripts from it stay, with connectionId null.
- GET /api/connections/:id/events → 200 `{ events: HookEvent[] }`, the newest 20.

Endpoints: webhooks

- POST /api/hooks/:source/:token. No session: the token is the key. Content-Type application/json, body at most 1,000,000 bytes.
- 202 `{ ok: true, outcome: "accepted", transcriptId }`: a new transcript.
- 200 `{ ok: true, outcome: "duplicate", transcriptId }`: the same external id arrived before.
- 200 `{ ok: true, outcome: "ignored" }`: an event type MOZOL does not use.
- Errors: hook_not_found, hook_paused, signature_invalid, payload_too_large, unsupported_media_type, bad_json, payload_invalid, rate_limited (60 requests per minute per token).
- Jamie's body: docs/backend/sources/jamie.md. The json source takes this body:

```ts
type JsonSourceBody = {
  id?: string;                         // the sender's id, 1..200 characters; a repeated id is a duplicate
  title?: string;                      // 1..300 characters
  occurredAt?: Time;                   // default: when the request arrived
  kind?: SourceKind;                   // default "call"
  learnerSpeaker?: string;             // the speaker name of the user, when the sender knows it
  segments: { speaker: string; text: string }[];   // 1..20000 segments, in order
};
```

Endpoints: transcripts

- POST /api/transcripts `{ title?, occurredAt?, text }` → 201 `{ transcript: Transcript }`. The paste source; text 1..400,000 characters, format in docs/product/sources.md.
- GET /api/transcripts → 200 paged `Transcript`, newest occurredAt first.
- GET /api/transcripts/:id → 200 `{ transcript: TranscriptDetail }`.
- POST /api/transcripts/:id/analyze → 202 `{ transcript: Transcript }`. Analyze again. Errors: transcript_busy (queued or analyzing for less than 30 minutes).
- DELETE /api/transcripts/:id → 204. Deletes the transcript, its analysis, findings and suggestions; pattern and word counts are recomputed. Recommendations stay, with transcriptId null.

Endpoints: patterns and words

- GET /api/patterns?status=active|learned|dismissed&language=<code> → 200 `{ patterns: Pattern[] }`, recurring first, then by lastSeenAt. language is optional.
- PATCH /api/patterns/:id `{ status }` → 200 `{ pattern: Pattern }`.
- GET /api/words?status=new|learning|known|dismissed&language=<code> → 200 `{ words: Word[] }`, newest lastSeenAt first. language is optional.
- PATCH /api/words/:id `{ status }` → 200 `{ word: Word }`.

Endpoints: devices

```ts
type PutDeviceBody = {
  platform: "ios";
  bundleId: string;                    // 1..200 characters
  appVersion: string | null;           // 1..50 characters
  osVersion: string | null;            // 1..50 characters
  apnsToken: string | null;            // lowercase hex, 64..200 characters
  apnsEnvironment: "sandbox" | "production" | null;   // null exactly when apnsToken is null
  remindersAccess: RemindersAccess;
};
```

- PUT /api/devices/:installationId PutDeviceBody → 200 `{ device: Device }`. Creates or updates the device of the current user. The app calls it after sign-in, on every launch, and whenever the APNs token or the Reminders access changes. A device registered by another user moves to the current user. A new or changed APNs token makes pushEnabled true again.
- GET /api/devices → 200 `{ devices: Device[] }`.
- DELETE /api/devices/:installationId → 204. The app calls it before signing out.
- POST /api/devices/:installationId/test-push → 202 `{ ok: true }`. Sends the test push (silent) to that device. Errors: not_found, push_not_configured.

Endpoints: recommendations and deliveries

- GET /api/recommendations?delivered=true|false → 200 paged `Recommendation`, newest first. Without the filter: all.
- GET /api/recommendations/:id → 200 `{ recommendation: Recommendation }`.
- POST /api/recommendations/:id/deliver → 202 `{ recommendation: Recommendation }`. Sends it to the phone: a new pending delivery.
- POST /api/deliveries/claim `{ installationId, limit? }` → 200 `{ deliveries: DeliveryItem[], leaseSeconds: 120, embedInMyReminders: boolean }`. limit 1..50, default 20. Hands out waiting deliveries, oldest first, at most one per marker, never one that another installation holds. A delivery not reported within the lease can be handed out again. installationId must be a device of the current user (404 not_found otherwise).
- POST /api/deliveries/results `{ installationId, results: DeliveryResult[] }` → 200 `{ accepted: number }`. 1..50 results. Results for deliveries this installation did not claim last are ignored and not counted.

```ts
type DeliveryItem = {
  deliveryId: Id;
  recommendation: Pick<Recommendation,
    "id" | "language" | "kind" | "itemKey" | "marker" | "title" | "notes" | "embedLine" | "matchTerms" | "url" | "priority">;
  schedule: { earliestAt: Time; activeFrom: string; activeTo: string; repeat: Repeat | null };
  // earliestAt: 2 hours after the claim; activeFrom, activeTo: from the user's reminderSettings
};

type DeliveryResult = {
  deliveryId: Id;
  outcome: DeliveryOutcome | "failed";
  errorCode?: string;                  // failed: a short app-side code, 1..64 characters
};
```

How the app applies a delivery

The app needs full access to Reminders. It reads the reminders of all lists and applies each delivery in claim order. There is no list of MOZOL's own: the app works with all of the user's reminders. It tells the reminders it created and the lines it added from everything else by hidden tags that carry the marker (docs/ios/reminders.md). The first step that fits decides the outcome.

1. embed_updated (only when embedInMyReminders is true): incomplete reminders the app did not create that hold a line the app added with this marker. In each, replace that line with embedLine.
2. reminder_updated: a reminder the app created with this marker, in any list, completed or not; when there are several, the most recently modified one. Set its title, notes, URL and priority, apply the schedule, and mark it not completed.
3. embedded (only when embedInMyReminders is true): the best incomplete reminder the app did not create. Its score is the number of matchTerms that match its title and notes, without the lines the app added. The best one has the highest score of at least 1; ties go to the most recently modified reminder, then to the smaller calendarItemIdentifier. Append embedLine as the last line of its notes: remove trailing line breaks, then add "\n" and embedLine (empty notes become embedLine alone). Nothing else changes.
4. created: create a reminder in the user's default list for new reminders (the one set in the Reminders app) with title, notes, URL (the recommendation url) and priority, and apply the schedule.

- Applying a schedule: the due time is earliestAt in the phone's current time zone; a time outside activeFrom..activeTo moves to the next activeFrom (the same day or the next one). Due date components in that time zone, one alarm at the due time, the repeat rule (or none), not completed. The worker knows no time zone.
- The app reports each outcome with POST /api/deliveries/results. failed covers anything that stopped the delivery; the worker hands it out again, up to 3 failed results in total.
- The worker never receives the user's reminders, their titles, notes or identifiers.
- The app applies deliveries in its own process: in the foreground, or when a silent push or the background task wakes it. There is no notification service extension.

Push notifications

Every push is a silent background push: the user sees nothing. A push only says "deliveries are waiting". It can be late, merged or dropped (iOS wakes an app in the background a few times per hour at most, and not at all after the user swipes it away), so the app also claims deliveries on every launch and every return to the foreground. The worker sends pushes through APNs to every device of the user that has an APNs token, to the host that matches the device's apnsEnvironment. Custom keys sit next to `aps` under `mozol`: `v` (payload version, 1) and `type`.

When an analysis or a "send to phone" creates deliveries, the worker sends one push to each device:

```json
{ "aps": { "content-available": 1 }, "mozol": { "v": 1, "type": "deliveries", "pending": 2 } }
```

Headers: apns-push-type background, apns-priority 5, apns-topic the device's bundle id, apns-expiration 1 hour ahead.

- type "test": the test push from the web app, the same shape without pending: `{ "aps": { "content-available": 1 }, "mozol": { "v": 1, "type": "test" } }`. The app logs it and shows the time of the last test push in Settings.
- The app shows no notifications, for pushes or anything else. A later version may show a hint when the user opens Instagram, only inside a Shortcuts flow (docs/ios/shortcuts.md).
- APNs answers 410 (Unregistered, ExpiredToken) or 400 BadDeviceToken: the worker stops pushing to that device until the app registers a new token.

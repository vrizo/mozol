Data model

D1 tables of the worker. Migrations: worker/migrations/ (rules in worker.md).

Conventions

- Ids are text: a table prefix, an underscore and a ULID, for example usr_01JB8Z6Q4M2V7N3K5D9X1C0F8T. worker/src/ids.ts makes them.
- Times are ISO 8601 UTC text with milliseconds: 2026-10-24T12:00:00.000Z.
- JSON columns are text holding valid JSON. Every JSON column is parsed with a zod schema when read.
- Booleans are integers 0 and 1.
- Languages are BCP 47 primary tags.
- Item keys and markers: shared/CONTRACT.md ("Recommendations"). Normalized text: shared/CONTRACT.md ("Text normalization").
- Foreign keys: every user_id references users with ON DELETE CASCADE, so deleting a user deletes all their rows. Other references are listed with each table. A column described as "plain" holds an id without a foreign key.

Accounts

users (usr)
- id, email (unique, lowercase), password_hash ("pbkdf2-sha256$100000$<salt b64>$<hash b64>"), display_name
- native_language
- speaker_names (JSON array of strings; "Your names" in the UI)
- reminder_settings (JSON: embed_in_my_reminders)
- created_at, updated_at

sessions (ses)
- id, user_id, token_hash (unique, SHA-256 hex of the token), kind (web or app)
- installation_id (app sessions), user_agent
- created_at, last_used_at, expires_at

app_codes
- code_hash (primary key, SHA-256 hex), user_id, created_at, expires_at, used_at

devices (dev)
- id, user_id, installation_id (unique, made by the app), platform (ios), bundle_id
- apns_token (hex, or null), apns_environment (sandbox or production, or null)
- app_version, os_version
- reminders_access (full, write_only, denied, restricted, not_determined)
- push_disabled_at, push_disabled_reason (set when APNs rejects the token)
- last_seen_at, created_at, updated_at

Sources

connections (con)
- id, user_id, source (jamie or json), label
- hook_token (unique), signing_secret (or null)
- status (active or paused), settings (JSON, per source)
- last_event_at, last_event_outcome, last_event_error
- created_at, updated_at

hook_events (evt): every request to a known webhook URL
- id, connection_id (references connections, cascade), user_id, received_at, request_id
- content_type, size_bytes, body (the raw body, at most 1,000,000 bytes; empty when refused as too large), body_sha256
- outcome (accepted, duplicate, ignored, refused), error_code
- transcript_id (references transcripts, set null)

Transcripts and analyses

transcripts (trn)
- id, user_id, connection_id (references connections, set null; null for paste), source (jamie, paste, json), external_id (the source's id, or null)
- kind (call, chat, text), title, occurred_at, duration_sec
- language (the conversation language from the analysis, or null)
- participants (JSON: id, name, email, is_recorder), segments (JSON: speaker_id, speaker_name, text, start_sec), at most 1,500,000 bytes
- learner_speaker_id, learner_word_count (null until the source rules or the speaker step choose; pipeline.md)
- status (received, queued, analyzing, analyzed, skipped, failed), skip_reason, error_code
- run (integer, counts analysis runs; 0 before the first), analyzed_at
- created_at, updated_at
- unique (connection_id, external_id)

analyses (ana): at most one per transcript; a new run replaces it
- id, transcript_id (unique, references transcripts, cascade), user_id, run
- prompt_version, model (the model that answered), status (the AnalysisResult status), language
- result (JSON AnalysisResult)
- input_tokens, output_tokens, cache_read_tokens, duration_ms, unmatched_quotes, created_at

findings (fnd): the findings of the transcript's current result
- id, transcript_id (references transcripts, cascade), analysis_id (plain), user_id, pattern_id (references patterns, cascade), language
- category, severity, occurrences, title, examples (JSON), explanation, tip, match_terms (JSON)
- created_at

word_suggestions (wsg): the words of the transcript's current result
- id, transcript_id (references transcripts, cascade), analysis_id (plain), user_id, word_id (references words, cascade), language
- reason, learner_said, example, example_translation, match_terms (JSON), created_at

keywords: the match terms of every transcript
- user_id, transcript_id (references transcripts, cascade), item_key, language (the conversation language), term (normalized), term_lang, mode
- primary key (transcript_id, item_key, term, term_lang, mode)

Per-user knowledge

patterns (pat): exists while at least one finding refers to it
- id, user_id, language, key, category, title and match_terms (JSON) from the newest finding
- occurrences_total, transcripts_count, sources (JSON array of source ids), first_seen_at, last_seen_at
- status (active, learned, dismissed)
- unique (user_id, language, key)

words (wrd): exists while at least one word suggestion refers to it
- id, user_id, language, word_key (the normalized term), term, type, translation, meaning, example, example_translation (from the newest suggestion)
- times_suggested, first_seen_at, last_seen_at
- status (new, learning, known, dismissed)
- unique (user_id, language, word_key)

Pattern and word counts are recomputed from findings and word suggestions after every change (pipeline.md).

Recommendations

recommendations (rec): one per analysis item
- id, user_id, transcript_id (references transcripts, set null), language
- kind (mistake, word), item_key, marker
- rank (the item's place in the delivery order of its transcript, from 1)
- title, notes, embed_line, match_terms (JSON, normalized), priority (1 or 5)
- content (JSON: the analysis item as the model returned it)
- created_at
- unique (transcript_id, item_key)

deliveries (dlv): a recommendation sent to the phone
- id, user_id, recommendation_id (references recommendations, cascade), marker
- status (pending, claimed, applied, failed, superseded), outcome (embed_updated, reminder_updated, embedded, created, or null)
- claimed_by (the installation of the last claim), claimed_until, failures, error_code
- created_at, updated_at

push_log (psh): every APNs request
- id, user_id, device_id (references devices, cascade), push_type (deliveries or test; every push is a silent background push), apns_id, status (HTTP status, null in log mode), reason (APNs reason), created_at

Worker

worker_state: small values shared by all worker instances
- key (primary key), value (JSON), updated_at
- apns_token: the APNs provider token and when it was made (push.md)

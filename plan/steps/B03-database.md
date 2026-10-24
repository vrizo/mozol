B03 Database schema

Track: backend. Depends on: B01. Next: B04.

Goal

The first migration creates every table of docs/backend/data-model.md in the local D1, with the constraints and indexes the worker needs. Small helpers for ids, times and JSON columns exist and are tested.

Read first

- AGENTS.md, plan/README.md
- docs/backend/data-model.md, docs/backend/worker.md, docs/backend/pipeline.md
- shared/CONTRACT.md (the enum values)

Do

1. worker/migrations/0001_init.sql with every table and column of data-model.md:
   - text primary keys; ISO time columns as TEXT; JSON columns as TEXT with CHECK (json_valid(col)); enums as CHECK (col IN (...)) with exactly the values of the docs and the contract.
   - foreign keys exactly as data-model.md lists them: every user_id with ON DELETE CASCADE; the other references with CASCADE or SET NULL as written next to each column; columns marked "plain" without a foreign key.
   - the unique keys of data-model.md.
   - indexes for the main reads: sessions(user_id); devices(user_id); connections(user_id); hook_events(connection_id, received_at); transcripts(user_id, occurred_at); findings(transcript_id), (pattern_id) and (user_id, pattern_id); word_suggestions(transcript_id), (word_id) and (user_id, word_id); keywords(user_id, term); recommendations(user_id, created_at) and (transcript_id); deliveries(user_id, status), (marker) and (recommendation_id); push_log(user_id, created_at).
   Check in the D1 docs (Context7) that D1 enforces foreign keys, and how. Report what you found.
2. worker/src/ids.ts: newId(prefix) returns "<prefix>_<ULID>" (26-character Crockford base32 ULID from the time and crypto.getRandomValues). Prefixes: usr, ses, dev, con, evt, trn, ana, fnd, wsg, pat, wrd, rec, dlv, psh.
3. worker/src/time.ts: nowIso() and helpers to add seconds or days to an ISO time.
4. worker/src/db/json.ts: readJson(text, schema) parses a JSON column with a zod schema and throws an error naming the column when it fails; writeJson(value) serializes.
5. Tests (the vitest config applies the migrations to the test D1 with the plugin's migration helpers):
   - every table exists;
   - deleting a user removes their sessions, devices, connections, hook events, transcripts, analyses, findings, patterns, words, recommendations and deliveries;
   - deleting a connection sets transcripts.connection_id to null and removes its hook events;
   - deleting a transcript removes its analysis, findings, word suggestions and keywords, and sets recommendations.transcript_id and hook_events.transcript_id to null; its recommendations and their deliveries stay;
   - the unique keys refuse duplicates (users.email, connections.hook_token, transcripts (connection_id, external_id), analyses.transcript_id, patterns (user_id, language, key), words (user_id, language, word_key), recommendations (transcript_id, item_key));
   - a CHECK refuses a wrong enum value and invalid JSON;
   - newId makes 26-character ULIDs that sort by time.
6. Apply the migration to the local database.

Checks

- `pnpm --filter worker test`, `pnpm -r typecheck`, `pnpm lint`
- `cd worker && pnpm exec wrangler d1 migrations apply mozol --local`
- `cd worker && pnpm exec wrangler d1 execute mozol --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"`: put the list in the report.

Out of scope

Applying the migration to production (B11 does it through scripts/deploy-worker.sh). Query code for later steps.

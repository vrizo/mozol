Worker and database

Worker

- Cloudflare Worker in worker/, Hono for routing, zod for every request and response body. Config in worker/wrangler.jsonc.
- Every route validates its input with a schema from shared/ and answers errors as JSON `{ "error": "<code>" }` with a matching HTTP status. Error codes are listed in shared/CONTRACT.md.
- `GET /api/health` answers `{"ok":true}`. Scripts and agents use it to check that a worker is up.
- Logging: one JSON object per line through worker/src/log.ts, `rid` first. Logs never contain the user's learning content — only ids, counts, timings and error codes.
- Tests: `cd worker && pnpm test` (vitest with the Cloudflare workers pool). Tests never call a real AI model or a remote service.

Database

- Cloudflare D1, binding `DB`. The database id is in worker/wrangler.jsonc.
- Every schema change is a numbered migration file in worker/migrations/ (`0001_<name>.sql`). A migration is never edited after it was applied to production; a fix is a new migration.
- Local dev uses a local D1: `pnpm exec wrangler d1 migrations apply <db> --local`.
- Production: `pnpm exec wrangler d1 migrations apply <db> --remote`, run by scripts/deploy-worker.sh before the deploy.
- Read the database to verify a result: `pnpm exec wrangler d1 execute <db> --local --command "SELECT ... LIMIT 20"`.

Deploy: ../deployment/infrastructure.md.

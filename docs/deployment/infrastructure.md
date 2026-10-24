Infrastructure

One environment: production. There is no staging.

- Domain: `mozol.vrizo.net`, a hostname in the existing Cloudflare zone `vrizo.net` (Free plan). No separate zone: a zone for a subdomain needs the Enterprise plan.
- Worker: Cloudflare Workers, name `mozol-api`, custom domain `mozol.vrizo.net`. One worker serves both the web app (the web/ build as static assets) and the API under `/api/`.
- Database: Cloudflare D1, name `mozol`.
- Workflow: `analyze-transcript` (class AnalyzeTranscript, binding ANALYZE), deployed with the worker. Pipeline: ../backend/pipeline.md.
- Plan: Workers Paid. The worker uses up to 30 seconds of CPU per request and per workflow step.
- Outside services the worker calls: the Anthropic API (api.anthropic.com) and APNs (api.push.apple.com, api.sandbox.push.apple.com).
- Token: one Cloudflare token and the account id in .env. Details: ../security/cloudflare-tokens.md.

Worker configuration

- Variables in worker/wrangler.jsonc: APP_ORIGIN (https://mozol.vrizo.net), ANALYSIS_MODE (claude), ANALYSIS_MODEL (claude-opus-5-5), ANALYSIS_EFFORT (high), PUSH_MODE (apns).
- Rate limit binding AUTH_LIMITER (namespace_id 4101): 10 requests per 60 seconds per client IP (CF-Connecting-IP), shared by sign-up, sign-in and app-token. A namespace_id is unique in the Cloudflare account: two bindings with the same id share their counters. Local development and tests run the limiter in Miniflare, so the limit applies there too.
- Secrets: ANTHROPIC_API_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY. Their values live in .env (keys listed in .env.example).
- Local development: scripts/dev-worker.sh writes worker/.dev.vars (mode 600, gitignored) from .env before it starts wrangler: APP_ORIGIN http://localhost:5190, ANALYSIS_MODE fixture (claude when MOZOL_ANALYSIS=claude is set), PUSH_MODE log, and ANTHROPIC_API_KEY when .env has it.

Deploy by agents

Agents deploy the worker themselves. The only path is scripts/deploy-worker.sh, which in order:

1. refuses to run with uncommitted changes in worker/, web/ or shared/, unless `--allow-dirty` is given (only for a deploy Vitalii asked for);
2. runs the worker tests;
3. builds the web app when web/ exists;
4. applies D1 migrations to production;
5. runs `wrangler deploy`;
6. checks `GET https://mozol.vrizo.net/api/health`.

Every deploy writes its own run folder, logs/<date>/run-N/, with run.json (git commit, branch, dirty flag) and deploy.log (the full output, with the version id wrangler prints). Any failed step stops the script with an error.

After a deploy, read production logs with scripts/prod-logs.sh. Workflow: skills/deploy-worker.

Secrets the worker needs are uploaded with `pnpm exec wrangler secret put <NAME>` from worker/, with the token from .env. A secret takes effect on the running deployment at once.

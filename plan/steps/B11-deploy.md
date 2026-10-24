B11 Deploy and production check

Track: backend. Depends on: B10 for the full release. The deploy part also runs earlier, right after B05, for the APNs risk check (plan/README.md).

Run this step only when the person running it asks for a deploy in words. Deploying is never inferred from finished work.

Goal

The worker, the web build and the database schema run on https://mozol.vrizo.net with all secrets set; a real push reaches a real iPhone; a real Jamie event and a real analysis work in production.

Read first

- AGENTS.md, plan/README.md
- skills/deploy-worker/SKILL.md, docs/deployment/infrastructure.md, docs/security/cloudflare-tokens.md, docs/backend/push.md
- skills/reading-logs/SKILL.md

Do

1. Before: the changes are committed (scripts/deploy-worker.sh refuses uncommitted changes in worker/, web/ and shared/) and reviewed as AGENTS.md says. `cd worker && pnpm test` passes.
2. Secrets, from worker/, each value piped from .env and never printed or typed on the command line: ANTHROPIC_API_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (`pnpm exec wrangler secret put <NAME>` with the token from .env). A key missing from .env is reported and skipped; the worker answers push_not_configured or analysis_failed for the parts that need it.
3. `scripts/deploy-worker.sh --check`, then `scripts/deploy-worker.sh` (timeout 10 minutes). It runs the tests, builds the web app, applies the remote migrations, deploys and checks /api/health. The custom domain mozol.vrizo.net comes from wrangler.jsonc; if the token cannot attach it, stop and report the error.
4. In parallel, `scripts/prod-logs.sh --for 300` (a second terminal or a background job), then:
   - https://mozol.vrizo.net shows the web app; /api/health answers {"ok":true};
   - sign up a test account on production (tell the person which email you used);
   - push check, with Vitalii: register his development build's APNs token with curl under the test account (PUT /api/devices/<any installation id> with apnsEnvironment sandbox and his bundle id), or let his build sign in through /app/signin when the iOS app has it; POST /api/devices/<installationId>/test-push; Vitalii confirms the push arrived. Read push_log on production: `pnpm exec wrangler d1 execute mozol --remote --command "SELECT push_type, status, reason, created_at FROM push_log ORDER BY created_at DESC LIMIT 5"`;
   - Jamie check, with Petr (full release only): create a Jamie connection, Petr pastes the URL into Jamie and presses Send Test Event; the event appears in the connection's events. After a real meeting, the transcript reaches analyzed and deliveries are waiting (or applied, when Vitalii's app claimed them).
5. Read the production log: `grep -E '"outcome":"(exception|exceededCpu)"|"level":"error"' logs/current/prod.log | head -c 4000`.

Report

The version id (grep "version id" in logs/current/deploy.log), the commit from run.json, the health result, the secrets that were set or missing, the push result with its APNs status, the Jamie result, and every error with its rid.

When something fails

Follow "When it fails" in skills/deploy-worker/SKILL.md. A failed APNs push from production (status other than 200, or no push on the phone) stops the plan: report the APNs reason and the HTTP status; the push path is decided again (docs/product/pending.md).

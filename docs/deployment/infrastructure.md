Infrastructure

One environment: production. There is no staging.

- Domain: `mozol.vrizo.net`, a hostname in the existing Cloudflare zone `vrizo.net` (Free plan). No separate zone: a zone for a subdomain needs the Enterprise plan.
- Worker: Cloudflare Workers, name `mozol-api`, custom domain `mozol.vrizo.net`. One worker serves both the web app (the web/ build as static assets) and the API under `/api/`.
- Database: Cloudflare D1, name `mozol`.
- Token: one Cloudflare token and the account id in .env. Details: ../security/cloudflare-tokens.md.

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

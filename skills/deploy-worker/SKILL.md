---
name: deploy-worker
description: Deploy the MOZOL Cloudflare Worker and apply D1 migrations to production, then verify with production logs. Use whenever a worker change must go live, or to check production after a deploy.
---

# deploy-worker

Agents deploy the worker themselves, always through scripts/deploy-worker.sh. Never run `wrangler deploy` or `wrangler d1 migrations apply --remote` by hand. Spec: docs/deployment/infrastructure.md.

## Before

1. The change is reviewed by Vitalii and committed. The script refuses uncommitted changes in worker/ or shared/; `--allow-dirty` is only for a deploy Vitalii asked for in words.
2. Tests pass locally: `cd worker && pnpm test`.
3. A new migration in worker/migrations/ was applied locally and checked against the local D1 (local-stack skill).
4. A migration is never edited after it reached production. A fix is a new migration.

## Deploy

    scripts/deploy-worker.sh --check   # token and config only, changes nothing
    scripts/deploy-worker.sh           # tests, remote migrations, deploy, health check

Run it with a Bash timeout of 10 minutes. It writes a run folder: logs/<date>/run-N/ with run.json and deploy.log. The version id is in deploy.log:

    grep -i "version id" logs/current/deploy.log | head -c 500

## After

1. Follow production for two minutes: `scripts/prod-logs.sh --for 120` (new run folder, prod.log).
2. Look for failures: `grep -E '"outcome":"(exception|exceededCpu)"|"level":"error"' logs/current/prod.log | head -c 4000`.
3. Report: the version id, the commit from run.json, the health result, and any errors with their `rid`.

## When it fails

- Tests failed: nothing was deployed. Fix and rerun.
- Migrations failed: the worker was not deployed. Read deploy.log; never edit the applied migration.
- Health failed after deploy: read prod.log. To go back, `cd worker && pnpm exec wrangler rollback` with the token from .env — only after telling Vitalii, because a rollback does not undo migrations.

Secrets: `cd worker && pnpm exec wrangler secret put <NAME>` with the value piped from .env, never typed on the command line or printed.

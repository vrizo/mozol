---
name: reading-logs
description: How to read MOZOL logs (local worker, web, iOS simulator app, deploys, production) without flooding context. Use before opening any log file.
---

Logs live in logs/YYYY-MM-DD/run-N/, one folder per run: a local stack start, a deploy, or a production log session. logs/current is a symlink to the newest run. Layout doc: docs/logs/layout.md.

Start here:
- `ls logs/` and `ls logs/<date>/` to list runs.
- `cat logs/current/run.json` — which service, commit and version wrote this run. Check it before you trust what the logs say about the code.

Files in a run folder: worker.log (local worker), web.log (Vite), app.log and app-history-*.log (iOS simulator), deploy.log (a deploy), prod.log (production tail).

Never cat a whole log file. Allowed patterns:
- tail -c 4000 logs/current/worker.log
- grep <pattern> logs/current/worker.log | head -c 4000
- grep -l <pattern> logs/<date>/*/*.log to find the run first

Narrow before you read:
- One request, both sides: `scripts/logs.sh --rid <id>`. Every worker line carries `rid`; the app prints the same id under its `api` category.
- App and worker in one timeline: `scripts/logs.sh --last 10m`, or plain `scripts/logs.sh` to follow live.
- One area of the app: `scripts/logs.sh --last 10m -c api` (categories: api, sync, notify, store, ui).
- The app alone, after the fact (also after a crash): `scripts/sim-logs.sh --last 10m [--category api]`.
- An older run: `scripts/logs.sh --run logs/<date>/run-<N> --last 1d`.
- Production: `scripts/prod-logs.sh --for 120` writes a new run folder with prod.log; then `grep '"outcome":"exception"' logs/current/prod.log | head -c 4000`.

UI test screenshots are in tests/screenshots/<date>/ — open single images, never loop over all of them.

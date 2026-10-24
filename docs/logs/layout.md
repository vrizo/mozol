Logs

Disk layout

Every run gets its own folder: logs/YYYY-MM-DD/run-N/. N starts at 1 each day and grows by one per run. logs/current is a symlink to the newest run. The logs/ folder is gitignored.

A run is one start of something: scripts/start-all.sh (or scripts/dev-worker.sh alone), one deploy, one production log session. Each run folder has:

- run.json — when the run started, which service, git commit, branch, whether the tree had uncommitted changes, the package version, the Node version. Read it first: it says which version of the code wrote the logs.
- worker.log — local worker (wrangler dev), one timestamped line per line of output.
- web.log — Vite dev server.
- app.log — the iOS app on the simulator, streamed live by scripts/sim-logs.sh; app-history-<HHMMSS>.log for a replay of what the simulator already recorded.
- deploy.log — a deploy by scripts/deploy-worker.sh.
- prod.log — production worker logs from scripts/prod-logs.sh.

Every line starts with the same timestamp shape, `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC), so files from different parts merge by sorting.

UI test screenshots go to tests/screenshots/<date>/, kept 7 days.

Content

Logs never contain the user's learning content: only ids, counts, timings and error codes.

App categories

The iOS app writes through one channel: `os.Logger`, subsystem `app.mozol`, declared once in MozolCore/Log.swift. The categories are a closed set:

- api — every HTTP call to the worker
- sync — moving data between the phone and the worker
- notify — scheduling and delivering reminders
- store — persistence: SwiftData, Keychain
- ui — screens

A new area of the app picks the category it belongs to; it does not add one.

Request id

Every request carries `X-Request-Id` (12 hex characters). The app and the web app log it; the worker prints it as `rid` on every line for that request. One request, both sides: `scripts/logs.sh --rid <id>`.

Tools

- scripts/logs.sh — app and worker in one timeline: `--last 10m`, `--rid <id>`, `-c <category>`, `--app`, `--worker`, `--run <dir>`.
- scripts/sim-logs.sh — the app alone, live or after the fact (`--last 10m`).
- scripts/prod-logs.sh — production worker logs into a run folder.

Reading rule for agents: never cat a whole log file. Read the skill skills/reading-logs.

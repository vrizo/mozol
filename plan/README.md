Implementation plan: backend and web app

This folder splits the MOZOL backend (worker, database, pipeline, push) and the web app into steps. Each step is one task for one AI agent that starts with an empty context. The iOS app follows shared/CONTRACT.md; "Two people" below says who does which steps.

How to run a step

1. Open a fresh agent session in the repository root (Claude Code reads AGENTS.md through CLAUDE.md).
2. Prompt: "Do plan/steps/<file>. Follow plan/README.md." Add anything the step asks for, for example "you may spend money on one model call".
3. Read the agent's report and the diff. Commit when it is good (AGENTS.md: nothing is committed without review).

Rules for every step

The agent reads this section before it starts.

- Read AGENTS.md, this file, the step file, and every file the step lists under "Read first", before you write code.
- shared/CONTRACT.md and docs/ are the source of truth. When the step needs something they do not say, stop and ask. Do not invent API shapes, table columns or error codes. When you find a mistake in them, say so in the report.
- Do only the step's scope. Write anything else you noticed into the report.
- Library and tool docs: use the Context7 MCP (Hono, zod, Wrangler, Workflows, D1, @cloudflare/vitest-plugin, Vite, React). For the Claude API use the claude-api skill.
- A new dependency follows docs/rules/dependencies.md: check the publish date, pin a version at least 72 hours old (pnpm-workspace.yaml enforces it), and update the planned set in that file when the package is not listed.
- User-facing strings (web/src/copy/en.ts, worker/src/copy.ts) are written by a separate subagent that follows docs/rules/ui-copy.md. Give it the list of strings needed and where they appear.
- Logs never contain learning content: no transcript text, no findings, no recommendation texts. Only ids, counts, timings and error codes.
- No hidden fallbacks. An error is returned or thrown with its code, and logged.
- Every Bash command that can hang gets a timeout (Bash tool parameter). Never cat a whole log file (skills/reading-logs).
- Run every check the step lists and report the real result, shortened. A check you could not run is reported as not run, with the reason.
- Do not commit, push or deploy. Only step B11 deploys, and only when the person running it asks for the deploy in words.

Report format

- What was done, by area, with file paths.
- Checks: each command and its result.
- Data checked in the database (query and the rows, shortened), where the step asks for it.
- Open questions and anything that differs from the docs.

Steps

Backend:
- B01 Foundation: workspace, worker skeleton, health, logging, local stack (steps/B01-foundation.md)
- B02 Shared schemas, text matching and fixtures (steps/B02-shared-schemas.md)
- B03 Database schema (steps/B03-database.md)
- B04 Accounts and sessions (steps/B04-accounts.md)
- B05 Devices and push (steps/B05-devices-push.md)
- B06 Sources, connections and intake (steps/B06-sources-intake.md)
- B07 Analysis core: prompt and Claude client (steps/B07-analysis-core.md)
- B08 Pipeline workflow, patterns and words (steps/B08-pipeline.md)
- B09 Recommendations and deliveries (steps/B09-recommendations.md)
- B10 Local end-to-end check (steps/B10-e2e-local.md)
- B11 Deploy and production check (steps/B11-deploy.md)

Web app:
- W01 Web foundation: router, API client, session, layout (steps/W01-web-foundation.md)
- W02 Sign-up, sign-in, app sign-in and profile (steps/W02-auth-profile.md)
- W03 Sources and connections (steps/W03-sources.md)
- W04 Activity and transcript (steps/W04-activity.md)
- W05 Patterns and words (steps/W05-patterns-words.md)
- W06 Recommendations and devices (steps/W06-recommendations.md)

Order

```
B01 → B02 → B03 → B04 ─┬─→ B06 → B08 ─┬─→ B09 → B10 → B11
         │             └─→ B05 ───────┘
         ├─→ B07 (any time before B08)
         └─→ W01 → W02 (after B04) → W03 (after B06) → W04, W05 (after B08) → W06 (after B09)
```

- B05 and B06 both need only B04, so they run at the same time. B09 needs B05 and B08.
- Steps on different branches of the graph run at the same time, each in its own git worktree or branch, merged into main one after the other.
- Before B02, Vitalii reviews shared/CONTRACT.md: the iOS app depends on the sign-in handoff, devices, recommendations, deliveries, text normalization and push payloads.

Two people

- Petr (WSL machine): B01 and B02 first, because every other step builds on them; then B03, B04, B06, B07, B08, B09, B10, B11.
- Vitalii (Mac): the iOS app against shared/CONTRACT.md and shared/fixtures/ (from B02 on: the claim response, push payloads and the text matching cases); B05, because he holds the APNs key, the bundle id and a test iPhone, and runs the APNs check; the web steps W01 to W06.
- When the iOS app takes all of Vitalii's time, Petr runs the web steps too, in a second worktree next to the backend steps.

Hand-offs:
- B02 in main: Vitalii starts the iOS app and W01.
- B04 in main: Vitalii does B05 and W02; Petr goes on with B06.
- B05 in main: one deploy and the APNs check (below), together.
- B06 in main: W03. B08 in main: W04 and W05. B05 and B08 in main: B09. B09 in main: W06, and the iOS app tests claims and outcomes against the local or the deployed worker.

Working in one repository:
- One branch per step (step/B05-devices-push), merged into main after the other person reviews it.
- Folders by owner: Petr: worker/, scripts/, docs/backend/; Vitalii: web/, ios/, docs/web/, docs/ios/, and in B05 worker/src/push/ and worker/src/routes/devices.ts. shared/ and shared/CONTRACT.md change only when both agree, in a small separate change.
- A conflict in package.json or pnpm-lock.yaml: take the version from main and run pnpm install again.

Prerequisites from people

- The Cloudflare token in .env works for this account (`scripts/deploy-worker.sh --check`). It expires on 2026-10-26; a new one is needed after that (docs/security/cloudflare-tokens.md).
- For B07 (the paid prompt check) and B11: ANTHROPIC_API_KEY in .env.
- For the APNs check and B11, from Vitalii: the APNs key (Key ID, Team ID, the .p8 file, put into .env as APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY), the app's bundle id, and the APNs device token of his development build (from the app's log).
- For the Jamie check in B11: the Jamie account on the Pro plan.

Early risk checks

- APNs from Cloudflare: the local runtime cannot reach APNs, and deployed Workers reach it only through Cloudflare's proxy, which Cloudflare does not document. After B05, deploy once (B11, deploy part only). Sign up a test account with curl, register a device with Vitalii's development token (apnsEnvironment sandbox, his bundle id) through PUT /api/devices, and call test-push with the app open in the foreground. If the app does not log the silent push, stop and decide the push path before B09.
- Prompt quality: after B07, run scripts/try-analysis.sh on the English and the German Jamie fixtures once (it costs money) and read the results before B08.

Machines

- Petr's machine is WSL2 Linux. The iOS parts of the scripts do not run there; use scripts/start-all.sh --no-app. Node 24 or newer comes from nvm; pnpm is installed by B01 with `npm install -g pnpm@<version>` (Node 26 has no corepack). lsof, perl, curl, jq and sqlite3 come from Homebrew (Linuxbrew); install anything else with brew.
- Vitalii's Mac runs the scripts as they are, with the iOS app (skills/local-stack).
- Web pages are checked in a browser through the chrome-devtools MCP.

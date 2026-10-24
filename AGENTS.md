# MOZOL — guide for AI agents

MOZOL helps people learn a language with small reminders that keep showing up in front of their eyes. It is built at a hackathon run by Jamie (first organizer) and {Tech: Europe}; their logos: assets/hackathon/. Parts: an iOS app (ios/), a Cloudflare Worker API (worker/), a Cloudflare D1 database, and a React web app (web/). Read order: this file, then docs/ by topic (index: docs/README.md), then shared/CONTRACT.md once it exists — the pinned API contract, source of truth for every client and the worker.

The whole project is in English: code, docs, UI, commit messages. The UI has one language, English.

## How to work here

- Delegate heavy work to subagents.
- Never dump long logs — tail -c 4000 or grep | head -c 4000. Rules: docs/logs/layout.md, skill skills/reading-logs.
- Every run writes its logs into its own folder: logs/YYYY-MM-DD/run-N/, with run.json naming the git commit and version. logs/current points at the newest run.
- No hidden fallbacks or silent recovery in code. Errors are loud.
- Verify at the database level when possible (local D1, the app store on the simulator — paths in skills/local-stack).
- Set timeouts for tests and simulations; never wait without a limit. macOS has no coreutils timeout — use the Bash tool's own timeout parameter.
- Agents deploy the worker and run migrations themselves, through scripts/deploy-worker.sh. Workflow and checks: skills/deploy-worker.
- Commits: for now, nothing is committed or pushed without Vitalii's review. Prepare the change, show the diff, wait.
- The repository is public. Never commit secrets, tokens, personal data, or generated local assets. .gitignore lists what stays local.
- Secrets live in one file, .env (gitignored, mode 600) — never echo them. To see which keys exist: `grep -oE '^[A-Z_]+=' .env`. To use one value, read that single key and pipe it into the consumer.
- Inline code comments are rare: only to say what a file or function is for, and the steps of a bigger function. Code explains itself.
- Apple's Xcode skills (swiftui-whats-new-27, test-modernizer, device-interaction, audit-xcode-security-settings) are installed for the user and override model training on their topics.

## Writing style

Applies to replies, reports, docs, code comments.

- Reply in the language of the request. Docs, code and UI are always English.
- Very simple English, short sentences. Formal register: no jokes, no buddy phrasing, no reassurance added to a fact. State the fact and stop.
- Explain every new term the first time it appears.
- Examples are specific, with a link to the data behind them (file path, run folder, request id).
- Banned words: "tainted", "overfit", "self-inflicted", "smoke-test", "doctrine", "corpus", "spurious", "prose", "leg" (for a branch or stage). Say instead: "came from X", "example copied too literally", "my own mistake", "quick check", "rule", "dataset", "false", "wording", "stage" or "branch".
- Docs are specification, not codebase explanation. Rules: docs/rules/writing-docs.md.
- UI copy: docs/rules/ui-copy.md.

## Docs map

- docs/architecture/ — how the parts fit together
- docs/product/ — the idea, features, pending decisions
- docs/ios/ — app rules, testing
- docs/web/ — React web app rules
- docs/backend/ — worker and database rules
- docs/deployment/ — infrastructure, deploy
- docs/security/ — Cloudflare tokens
- docs/logs/ — log layout and reading rules
- docs/rules/ — writing docs, UI copy, assets, dependencies

Implementation steps for the backend and the web app, one agent task per file: plan/README.md.

## Skills

Project skills live in skills/ (one folder per skill, SKILL.md inside). .claude/skills and .agents/skills are symlinks to it.

- reading-logs — read logs without flooding context
- local-stack — start worker, web app and iOS app; tests; logs; databases
- deploy-worker — deploy the worker and apply migrations, then check production

TestFlight uploads: docs/deployment/testflight.md.

## Commands

- scripts/start-all.sh — worker + web app + simulator app in one go; `--stub` uses scripts/stub-api.mjs instead of the worker. scripts/stop-all.sh reverses it. One run folder per start.
- scripts/sim-push.sh — feed a silent push payload to the app on the simulator.
- scripts/testflight.sh — archive and upload the iOS app to TestFlight; writes a run folder.
- scripts/apns-push.mjs — send a silent push to one device through APNs (docs/ios/push-testing.md).
- scripts/logs.sh — app + worker in one timeline (`--last 10m`, `--rid <id>`, `-c <category>`).
- scripts/deploy-worker.sh — tests, migrations, deploy, health check; writes a run folder with deploy.log.
- scripts/prod-logs.sh — production worker logs (wrangler tail) into a run folder.

## Dev environment facts

- Worker dev port 8790, web dev port 5190. nobardak uses 8787 on the same Mac, so the ports differ.
- Use `pnpm exec wrangler`, never the global wrangler (it is old).
- The Xcode project is generated: edit ios/project.yml, run xcodegen generate in ios/. Never hand-edit the pbxproj.
- Build into ios/.build-dd only (disk is tight; DerivedData and iOS DeviceSupport are safe to purge when full).
- Stale builds: when behavior contradicts the source, rm -rf ios/.build-dd and rebuild clean.
- Never pass CODE_SIGNING_ALLOWED=NO for the app target: simulator builds are ad-hoc signed, and an unsigned app fails every Keychain call.
- Simulator: iPhone 17, UDID 898564DD-FAE8-4AB0-9BF5-CBF17DB72852 (shared with nobardak; set MOZOL_SIM_UDID to use another one).
- workerd: never call a stored global fetch through a property — "Illegal invocation". Wrap it: (input, init) => fetch(input, init).
- No rsvg or imagemagick on this Mac — render SVG with scripts/render-svg.swift (keeps transparency). Brand marks are drawn by hand, one per size (docs/web/design-system.md).

Open decisions waiting on Vitalii: docs/product/pending.md.

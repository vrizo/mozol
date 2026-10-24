<a href="https://github.com/vrizo/mozol">
    <img src="assets/icons/mozol-favicon.png" alt="MOZOL" width="96" height="96" align="left">
</a>
<a href="https://www.meetjamie.ai/">
    <img src="assets/hackathon/jamie-logo.svg" alt="Jamie" width="96" height="96" align="left">
</a>
<a href="https://techeurope.io/">
    <img src="assets/hackathon/tech-europe-logo.svg" alt="{Tech: Europe}" width="96" height="96" align="left">
</a>

<br clear="all">

# MOZOL

Built at the Jamie × {Tech: Europe} hackathon.

Learn a language with small reminders that stay in front of your eyes. A word or a short phrase shows up again and again during the day, until you know it.

If you are an AI agent, start with AGENTS.md, then docs/ by topic.

## Parts

- ios/ — iOS app, SwiftUI. Shows the reminders.
- web/ — web app, React + Vite. Manage words and settings.
- worker/ — API, Cloudflare Worker (Hono + zod).
- Database — Cloudflare D1, migrations in worker/migrations/.
- shared/ — schemas and the API contract (shared/CONTRACT.md).

The project is at the start: the docs, skills and scripts exist, the code does not yet. Open decisions: docs/product/pending.md.

## Local development

Needs Node 24+, pnpm, Xcode, xcodegen.

```
cp .env.example .env && chmod 600 .env   # Cloudflare token, used for dev and deploy
scripts/start-all.sh              # worker :8790, web :5190, iOS simulator app
scripts/stop-all.sh
```

Logs go to logs/YYYY-MM-DD/run-N/, one folder per run; logs/current is the newest. Read both sides in one timeline with `scripts/logs.sh --last 10m`. Details: docs/logs/layout.md.

## Deploy

```
scripts/deploy-worker.sh             # tests, migrations, deploy, health check
```

Token setup: docs/security/cloudflare-tokens.md.

## Language

The project and its UI are English only.

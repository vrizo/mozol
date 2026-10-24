Architecture

MOZOL has four parts in one repository (a pnpm workspace plus the Xcode project).

- ios/ — the iOS app, SwiftUI. Shows the reminders: items in the Apple Reminders app written with EventKit, notifications and other small surfaces the user sees many times a day. Pure logic lives in the MozolCore Swift package (ios/MozolCore): no UIKit, no system frameworks with side effects, testable on any Mac with `swift test`. Adapters and UI live in the app target.
- web/ — the web app, React with Vite. Its static build is served by the worker. The user signs up, connects sources and reads analyses there.
- worker/ — one Cloudflare Worker (Hono + zod) on https://mozol.vrizo.net: the API under /api/, and the web build as static assets on every other path. The only part that talks to the database.
- shared/ — zod schemas and test fixtures used by the worker and the web app, and shared/CONTRACT.md, the pinned API contract. The iOS app follows the contract and is tested against the same fixtures.

Data flow

1. A source (Jamie, a paste, a JSON webhook) delivers a transcript to the worker: ../product/sources.md.
2. The worker stores it and starts a Cloudflare Workflow run. The run asks the Claude API for an analysis, stores mistakes, patterns and words in D1, and makes recommendations: ../backend/pipeline.md.
3. The worker sends an APNs push to the user's iPhone: ../backend/push.md.
4. The iOS app claims the deliveries and places each recommendation in the Apple Reminders app with EventKit: into a reminder of the user that mentions it, or into a new reminder: ../product/reminders.md.
5. The web app shows transcripts, analyses, patterns, words and recommendations.

Database: Cloudflare D1. Schema changes are migration files in worker/migrations/, applied with `wrangler d1 migrations apply`. Rules: ../backend/worker.md.

Request id: every HTTP request from a client carries `X-Request-Id`, 12 hex characters minted per request. The client logs it, the worker prints it as `rid` on every line it writes for that request and echoes the header back. A request without one gets an id minted by the worker. This is what joins logs across parts: ../logs/layout.md.

Environments: local (wrangler dev with a local D1, the Vite dev server proxying /api/ to the worker, the iOS simulator) and production. There is no staging. Details: ../deployment/infrastructure.md.

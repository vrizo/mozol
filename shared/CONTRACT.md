MOZOL API contract

Pinned contract between the worker, the web app and the iOS app. Base URL: https://mozol.vrizo.net. All routes are under /api/. Bodies are JSON, UTF-8.

Common rules

- Every request carries `X-Request-Id`: 12 lowercase hex characters, minted per request. The worker echoes it back.
- Authenticated routes take `Authorization: Bearer <token>`.
- An error answers `{ "error": "<code>" }` with a matching HTTP status.

Status on 2026-10-24: only the health route is final. Another developer builds the worker. The routes marked "placeholder" are what the iOS app calls today: a proposal until that developer confirms them. Their bodies change when the data format is decided (docs/product/pending.md). scripts/stub-api.mjs implements them for local tests.

GET /api/health

- Answer 200: `{ "ok": true }`.

GET /api/messages?after=<cursor> — placeholder, authenticated

- `after` is optional: the cursor from the previous answer. Without it the server returns its oldest messages.
- Answer 200: `{ "messages": [ { "id": "<string>", ... } ], "cursor": "<string>" | null }`.
- `id` is unique per message. Every other field of a message is free-form for now; the app stores each message object as raw JSON.
- `cursor` is null when the server has no cursor to give; the app then keeps its previous one.

POST /api/devices — placeholder, authenticated

- Body: `{ "token": "<APNs device token, hex>", "platform": "ios", "environment": "development" | "production" }`.
- Answer 200: `{ "ok": true }`.

Silent push — placeholder

- APNs payload: `{ "aps": { "content-available": 1 }, ... }`, push type `background`, priority 5, topic `net.vrizo.mozol`. Every other top-level key is free-form for now.

POST /api/auth/login — planned, not called yet

- Body: `{ "email": "<string>", "password": "<string>" }`.
- Answer 200: `{ "token": "<string>" }`. Error: 401 `{ "error": "invalid_credentials" }`.

Web pages the iOS app opens

- /signup — the sign-up page, shown in an in-app web view (docs/product/accounts.md).

GET /.well-known/apple-app-site-association — needed for Password AutoFill

- Served over HTTPS without redirects, `Content-Type: application/json`.
- Body: `{ "webcredentials": { "apps": ["5X3V5CCN2N.net.vrizo.mozol"] } }`.

B05 Devices and push

Track: backend. Depends on: B04. Runs at the same time as B06 to B08. B09 needs it. The iOS app depends on this step; after it, run the APNs risk check from plan/README.md.

Goal

The iOS app can register its device and APNs token. The worker can send alert, background and test pushes through APNs, or record them in log mode, and keeps device tokens healthy.

Read first

- AGENTS.md, plan/README.md
- docs/backend/push.md, docs/deployment/infrastructure.md (worker configuration)
- shared/CONTRACT.md: Device, "Endpoints: devices", "Push notifications"
- docs/backend/data-model.md: devices, push_log, worker_state
- worker/src/ (from B01 to B04)

Do

1. worker/src/routes/devices.ts (requireUser):
   - PUT /api/devices/:installationId: create or update the device by installation_id; a device that belonged to another user moves to the current user; a new or changed apnsToken clears push_disabled_at and push_disabled_reason; pushTypes, when given, goes to push_types; update last_seen_at; 200 { device }.
   - GET /api/devices, DELETE /api/devices/:installationId (204; 404 for an unknown or foreign device).
   - POST /api/devices/:installationId/test-push: sends the test alert push; 202 { ok: true }; 503 push_not_configured in apns mode without the APNs secrets.
2. worker/src/push/config.ts: reads PUSH_MODE (apns or log; any other value throws), APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY.
3. worker/src/push/token.ts: the provider token. ES256 JWT, header { alg: "ES256", kid }, claims { iss, iat }; import the key as PKCS#8 from the base64 secret; sign with WebCrypto ECDSA P-256 SHA-256 (the signature is already the raw r||s form JWS needs). Keep it in worker_state under apns_token; reuse it while it is younger than 50 minutes.
4. worker/src/push/apns.ts: send(device, payload, headers) for one device. It takes a fetch function as a parameter (tests pass a fake). Host by apnsEnvironment. Handle the answers as docs/backend/push.md says: write push_log for every request; 410 or 400 BadDeviceToken disables the device; 403 ExpiredProviderToken or InvalidProviderToken makes a new token and retries once; 429 and 5xx throw a retryable error; other 4xx are logged and not retried. In log mode: write push_log with status null, log the push (type, device id, no texts), send nothing.
5. worker/src/push/payloads.ts: builders for the alert push, the background push and the test push from shared/src/push.ts, with the headers from the contract (push type, priority, topic = device bundle id, collapse id, expiration).
6. worker/src/push/notify.ts: notifyUser(env, userId, { transcriptId, transcriptTitle, pending, collapseId }) sends the alert and the background push to every device of the user that has an APNs token, is not disabled and allows that push type. It returns counts (sent, skipped, failed) and throws a retryable error when any device got 429 or 5xx. B09 calls it from the pipeline and from "send to phone".
7. User-facing strings in worker/src/copy.ts, written by the copy subagent: the test push title and body; the deliveries push title and body with the transcript title and the number of recommendations in it (and variants for a transcript without a title and for "send to phone").

Checks

- Tests: device create, update, move to another user, delete; a new token clears the disabled state; test-push in log mode writes push_log and answers 202; test-push in apns mode without secrets answers 503 push_not_configured.
- Token test: generate a P-256 key pair in the test, export the private key as PKCS#8 base64, make a token, verify the signature with the public key, check header and claims, and check that a second call within 50 minutes reuses the stored token.
- APNs answer tests with a fake fetch: 200 writes push_log; 410 and 400 BadDeviceToken disable the device; 403 ExpiredProviderToken retries once with a new token; 429 and 500 throw a retryable error; the request goes to the sandbox or production host by device.
- Payload tests: the payloads parse with the shared push schemas and stay under 4096 bytes with a 200-character title.
- `pnpm --filter worker test`, `pnpm -r typecheck`, `pnpm lint`
- Local flow with curl: get a bearer token (B04 flow), PUT a device with a fake 64-hex token, POST test-push, then `SELECT push_type, status, reason FROM push_log` in the local D1.

Out of scope

Sending a real push: the local runtime cannot reach APNs. The real test runs on a deployed worker (B11, after this step).

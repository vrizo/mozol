Push

The worker sends Apple push notifications itself, through the APNs provider API with token authentication. Payloads and headers: shared/CONTRACT.md.

Configuration

- APNS_KEY_ID and APNS_TEAM_ID: worker secrets, from the Apple Developer account.
- APNS_PRIVATE_KEY: worker secret, the base64 text of the .p8 key file between its BEGIN and END lines, joined into one line.
- PUSH_MODE: worker variable. apns sends real pushes. log writes each push to push_log (status null) and to the log instead of sending it. Production uses apns. Local development and tests use log.
- The topic is the bundle id from the device registration.

Provider token

- An ES256 JWT with header { alg: ES256, kid: APNS_KEY_ID } and claims { iss: APNS_TEAM_ID, iat: now in seconds }, signed with WebCrypto.
- All worker instances share one token: it lives in the worker_state table under the key apns_token and is replaced when it is older than 50 minutes.

Sending

- Host by the device's apnsEnvironment: https://api.sandbox.push.apple.com for sandbox, https://api.push.apple.com for production.
- POST /3/device/<apns token> with authorization: bearer <JWT> and the headers from the contract.
- Every request is written to push_log: device, push type, apns-id, HTTP status and APNs reason.
- 410 (Unregistered, ExpiredToken) or 400 BadDeviceToken: the device gets push_disabled_at and push_disabled_reason, and gets no pushes until the app registers a new token.
- 403 ExpiredProviderToken or InvalidProviderToken: the worker makes a new provider token and sends once more.
- 429 and 5xx: the notify step of the pipeline retries.
- Other 4xx answers are logged with the reason and not retried.

Test push

POST /api/devices/:installationId/test-push sends the test push (silent, shared/CONTRACT.md) to one device. With PUSH_MODE log it writes push_log and answers 202. Without APNs configuration in apns mode it answers 503 push_not_configured.

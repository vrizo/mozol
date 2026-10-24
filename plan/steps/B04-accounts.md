B04 Accounts and sessions

Track: backend. Depends on: B02, B03. Next: B05. The web app (W02) and the iOS app depend on this step.

Goal

Users can sign up, sign in and out on the web, hand the session to the iOS app with a one-time code, read and change their profile, and delete their account. Every later route can require a signed-in user.

Read first

- AGENTS.md, plan/README.md
- docs/product/accounts.md
- shared/CONTRACT.md: Conventions, Authentication, Errors, User, ReminderSettings, "Endpoints: accounts"
- docs/backend/data-model.md: users, sessions, app_codes
- worker/src/ (from B01 and B03), shared/src/accounts.ts

Do

1. worker/src/auth/password.ts: PBKDF2-SHA256 with WebCrypto, 100,000 iterations, 16-byte random salt, 32-byte key, stored as "pbkdf2-sha256$100000$<salt base64>$<hash base64>"; verify with a constant-time comparison.
2. worker/src/auth/tokens.ts: random 32-byte tokens in base64url; SHA-256 hex for storage.
3. worker/src/auth/session.ts:
   - a middleware that reads `Authorization: Bearer` or the mozol_session cookie, finds the session by token hash, refuses an expired one, and puts user and session on the context;
   - it extends expires_at (30 days web, 365 days app) and last_used_at at most once per hour, to keep writes low;
   - requireUser answers 401 unauthorized without a valid session.
4. Origin check: a cookie-authenticated request with a method other than GET must have Origin equal to APP_ORIGIN, otherwise 403 forbidden. Bearer requests and /api/hooks/* skip the check.
5. Routes (shared schemas validate every body and every response in tests):
   - POST /api/auth/sign-up: lowercase the email; 409 email_taken; create the user with speakerNames [displayName] and reminderSettings { embedInMyReminders: true, intensity: "normal", activeFrom: "09:00", activeTo: "21:00" }; create a web session; set the cookie (HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 30 days); 201 { user }.
   - POST /api/auth/sign-in: 401 invalid_credentials for a wrong email or password. When the email is unknown, still run one PBKDF2 hash so both cases take the same time.
   - POST /api/auth/sign-out: delete the current session; clear the cookie (Max-Age=0); 204.
   - POST /api/auth/app-code: web session only (a bearer session gets 403 forbidden); store the code hash with a 2-minute expiry; 201 { code, expiresAt }.
   - POST /api/auth/app-token: no session; the code must exist, be unused and not expired (else 400 code_invalid); mark it used; create an app session with the installationId; 201 { token, user }.
   - GET /api/me, PATCH /api/me, DELETE /api/me (checks the password, then deletes the user; the cascade removes everything else; clears the cookie; 204).
6. Rate limits with the Workers rate limiting binding (Context7: Cloudflare "rate limiting" binding): AUTH_LIMITER, 10 requests per 60 seconds per client IP (CF-Connecting-IP) for sign-up, sign-in and app-token. Over the limit: 429 rate_limited with Retry-After: 60. Find out how the binding behaves in local dev and in tests, and report it.
7. User-facing strings: none in this step (errors are codes).

Checks

- Tests for every endpoint and error code: sign-up and sign-in set the cookie with the right attributes; the cookie and the bearer token both work for GET /api/me; an expired session gets 401; a cookie POST with a wrong or missing Origin gets 403; app-code with a bearer session gets 403; a code works once and expires; PATCH validates (a bad language code, bad times); DELETE /api/me removes the user's rows; sessions store hashes only.
- `pnpm --filter worker test`, `pnpm -r typecheck`, `pnpm lint`
- Local flow with curl against `scripts/start-all.sh --no-app`: sign up (with `-H "Origin: http://localhost:5190"` and a cookie jar), GET /api/me with the cookie, app-code, app-token, GET /api/me with the bearer token, sign out. Report the status codes.
- Database: `SELECT kind, length(token_hash), expires_at FROM sessions LIMIT 5` in the local D1 shows 64-character hashes.

Out of scope

Password reset. Sign in with Apple. Web pages (W02).

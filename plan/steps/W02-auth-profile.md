W02 Sign-up, sign-in, app sign-in and profile

Track: web. Depends on: W01, B04. Next: W03.

Goal

A user can sign up, sign in and out, hand the session to the iOS app, edit the profile and reminder settings, and delete the account.

Read first

- AGENTS.md, plan/README.md
- docs/product/accounts.md, docs/product/web-app.md, docs/rules/ui-copy.md, docs/web/rules.md
- shared/CONTRACT.md: User, ReminderSettings, "Endpoints: accounts", Errors
- web/src/ from W01

Do

1. Languages: web/src/languages.ts lists about 100 common language codes with names from Intl.DisplayNames in English, sorted by name; any language is allowed (docs/product/analysis.md). Time zones from Intl.supportedValuesOf("timeZone"); the default is the browser's.
2. Sign up (/signup): email, password, display name, native language, time zone (prefilled). Show field errors from validation_failed issues next to their fields; email_taken next to the email. On success go to next (only a same-site path) or /activity.
3. Sign in (/signin): email and password; invalid_credentials and rate_limited as notices. On success go to next or /activity.
4. Sign out: in the header menu and on the profile page; afterwards go to the home page.
5. App sign-in (/app/signin?return=...):
   - return must start with "mozol://"; otherwise show an error page and nothing else;
   - signed out: the sign-in form with a link to sign up (both stay on this flow);
   - signed in: "Continue as <name>" and "Use another account" (signs out first);
   - on continue or after sign-in: POST /api/auth/app-code, then set window.location to the return address with code=<code> added as a query parameter; also show a link with the same address in case the app does not open.
6. Profile (/profile): display name, native language, speaker names (add and remove, at most 10), time zone, reminder settings (add recommendations to my own reminders on or off; intensity light, normal or intense; active hours from and to). Save with PATCH /api/me and show the saved state. Delete account: a confirm dialog that asks for the password, then DELETE /api/me, then the home page.
7. Strings in web/src/copy/en.ts by the copy subagent.

Checks

- vitest for the pure helpers: the return address check (mozol://auth passes; https://x, javascript:..., mozol:/x and an empty value fail), adding code to an address with and without a query, the next-path check (only paths starting with a single "/"), mapping issues to fields.
- `pnpm --filter web test`, `pnpm --filter web build`, `pnpm lint`
- Browser (chrome-devtools MCP) against the local stack: sign up, land on Activity, sign out, sign in, edit the profile and reload (values stay), app sign-in with return=mozol://auth (check the attempted navigation or the link address contains code=), the error page for return=https://example.com, delete the account. At 360 px and 1280 px; keyboard only for sign-in. Screenshots to tests/screenshots/<date>/. Close your tabs.

Out of scope

Password reset, social sign-in.

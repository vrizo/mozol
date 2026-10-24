W01 Web foundation: router, API client, session, layout

Track: web. Depends on: B02 (B04 for the session to work end to end). Next: W02.

Goal

The web app has a router with every screen of docs/product/web-app.md as a page (empty pages are filled by later steps), one API client, a session context, a responsive layout with navigation, and shared states for loading, empty and errors. The landing intro stays the home page.

Read first

- AGENTS.md, plan/README.md
- docs/product/web-app.md, docs/web/rules.md, docs/rules/ui-copy.md
- shared/CONTRACT.md: Conventions, Authentication, Errors, User
- web/src/ (App.tsx, home/, copy/en.ts, styles.css), shared/src/

Do

1. Add the workspace package shared to web. API data is parsed with its schemas.
2. web/src/api.ts, the only module that calls fetch:
   - request(method, path, { body, query, schema }): JSON in and out, credentials same-origin, a new X-Request-Id per request (12 lowercase hex characters from crypto.getRandomValues);
   - a non-2xx answer throws ApiError { status, code, issues, rid } from the error body; an answer that does not match the schema throws ApiError with code bad_response;
   - logs `[api] → METHOD /path rid=<id>` and `[api] ← <status> rid=<id> <ms>ms` to the console;
   - typed functions grouped by area; this step adds getMe and signOut, later steps add theirs.
3. web/src/router.tsx: a small router without a dependency. A route table with path patterns (":id" parameters), useRoute() (name, params, query), navigate(to, { replace }), a Link component that keeps normal link behavior (modifier keys, middle click), history and popstate handling, scroll to top and focus on main after navigation. An unknown path shows a not-found page.
4. web/src/session.tsx: SessionProvider loads GET /api/me once (401 means signed out); exposes user, status (loading, signed-in, signed-out), refresh and signOut. RequireUser sends a signed-out user to /signin?next=<current path and query>.
5. Layout: a header with the MOZOL wordmark and navigation (Activity, Patterns, Words, Sources, Recommendations, Profile) for signed-in users; one main element with id main-content per page; the existing skip link. At 360 px the navigation fits without horizontal scroll (a menu button or wrapping). The home page keeps the intro and its text block with the links to /signup and /signin; for a signed-in user the links become one link to Activity.
6. UI parts in web/src/ui/: Button, TextField, Select, Checkbox, Notice, ErrorState (says what failed and the error code, and offers retry), Loading, Empty, PageHeader, ConfirmDialog (a native dialog element). Styles in web/src/styles.css: keep the landing tokens (--bg, --ink, --muted), add spacing and type scales and a few semantic colors that meet WCAG AA on --bg; one global :focus-visible rule; system sans-serif text, monospace for URLs and codes.
7. Pages for every route of docs/product/web-app.md (/signup, /signin, /app/signin, /activity, /activity/:id, /patterns, /words, /sources, /sources/paste, /sources/:id, /r/:id, /recommendations, /profile), each with its title and an Empty state, and a Not found page. /sources/paste is matched before /sources/:id.
8. All strings in web/src/copy/en.ts, written by the copy subagent.

Checks

- vitest (node environment) for pure code: route matching and parameters, building URLs with query strings, request id format, error parsing into ApiError, bad_response on a schema mismatch (fetch replaced by a fake).
- `pnpm --filter web test`, `pnpm --filter web build`, `pnpm lint`, `pnpm -r typecheck`
- Browser (chrome-devtools MCP) against `scripts/start-all.sh --no-app`: home at 360 px and 1280 px; the skip link and the navigation work with the keyboard; a signed-out visit to /activity goes to /signin?next=%2Factivity; no console errors except the expected 401 from /api/me. Save screenshots to tests/screenshots/<date>/ and list them in the report. Close the tabs you opened.

Out of scope

Forms and data on the pages (W02 to W06).

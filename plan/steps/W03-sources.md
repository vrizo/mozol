W03 Sources and connections

Track: web. Depends on: W02, B06. Next: W04.

Goal

The user connects Jamie or a JSON webhook, copies the webhook URL, follows the setup steps, sees the events that arrived, manages the connection, and can paste a transcript.

Read first

- AGENTS.md, plan/README.md
- docs/product/sources.md, docs/product/web-app.md (Sources, Connection), docs/backend/sources/jamie.md (setup steps), docs/rules/ui-copy.md
- shared/CONTRACT.md: Source, Connection, HookEvent, JsonSourceBody, "Endpoints: sources and connections", POST /api/transcripts
- web/src/ from W01 and W02

Do

1. Sources (/sources): the user's connections (label, source name, status, last event time, outcome and error code), and actions: connect Jamie, connect Webhook JSON, paste a transcript.
2. Connecting creates the connection (POST /api/connections) and opens its page.
3. Connection (/sources/:id):
   - the webhook URL in monospace with a copy button (navigator.clipboard; a short "copied" state; when the clipboard is refused, select the text and say how to copy);
   - the setup steps from GET /api/sources for this source;
   - Jamie: a field for the signing secret (set or remove; the page shows only whether one is set);
   - JSON: a sample curl request built from the URL and shared/fixtures/json/transcript.json;
   - the last 20 events (time, outcome, error code, size, a link to the transcript), refreshed every 10 seconds while the page is visible and with a refresh button;
   - rename, pause or resume, replace URL (a confirm dialog saying the old URL stops working), delete (a confirm dialog).
4. Paste (/sources/paste): title (optional), date and time (optional), the text (with a short note on the "Name: text" format), submit with POST /api/transcripts, then go to /activity/<id>.
5. Strings in web/src/copy/en.ts by the copy subagent.

Checks

- vitest for pure helpers: building the sample curl command (the URL and the body quoted safely), formatting event outcomes and sizes.
- `pnpm --filter web test`, `pnpm --filter web build`, `pnpm lint`
- Browser against the local stack: connect Jamie, copy the URL, post shared/fixtures/jamie/meeting-completed.json to it with curl (data.user.email set to your account), see the event appear within 10 seconds, set and remove a signing secret, pause (a new curl gets 403), resume, replace the URL (the old one gets 404), delete. Paste the shared/fixtures/paste/transcript.txt text and land on its transcript page. 360 px and 1280 px. Screenshots to tests/screenshots/<date>/. Close your tabs.

Out of scope

The transcript page content (W04).

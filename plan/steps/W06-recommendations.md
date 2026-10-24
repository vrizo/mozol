W06 Recommendations and devices

Track: web. Depends on: W02, B09. Last web step.

Goal

The user sees what MOZOL sent to the phone and what it did there (added to a reminder of the user, updated, new reminder), opens a recommendation from a MOZOL reminder, sends more recommendations to the phone, and checks their devices with a test push.

Read first

- AGENTS.md, plan/README.md
- docs/product/reminders.md, docs/product/web-app.md (Recommendation, Recommendations), docs/rules/ui-copy.md
- shared/CONTRACT.md: Recommendation, Delivery, Device, "Endpoints: devices", "Endpoints: recommendations and deliveries"
- web/src/ from W01 to W05

Do

1. Recommendations (/recommendations): two tabs in the URL (?delivered=true, the default, and ?delivered=false). Each recommendation: kind, language, title, the embed line, the delivery state and outcome in plain words (waiting, on the phone: added to one of your reminders, updated, new reminder; failed with its code), the date, a link to its transcript (none when transcriptId is null), and "send to phone" for one without a waiting delivery. Paged with "load more".
2. Below the list: the user's devices with app version, push enabled, Reminders access, last contact, and a "send test push" button (POST test-push; 503 push_not_configured shown as a notice).
3. Recommendation (/r/:id): title, the notes as they look on the phone (pre-wrapped text), the embed line, the match terms with their languages and modes, priority, the delivery history state, a link to the transcript, and "send to phone". A recommendation of another user or an unknown id shows the not-found state. A signed-out visitor goes to sign in and comes back.
4. Strings in web/src/copy/en.ts by the copy subagent.

Checks

- vitest for pure helpers: the outcome and state texts, the match term mode labels.
- `pnpm --filter web test`, `pnpm --filter web build`, `pnpm lint`
- Browser against the local stack: after the B10 script ran (or the same steps by hand), the list shows delivered recommendations with their outcomes and the not-sent tab shows recommendations of dismissed patterns and known or dismissed words; "send to phone" makes a waiting delivery and a push_log row; /r/<id> shows the notes and terms; a device registered with curl appears; the test push button answers. 360 px and 1280 px. Screenshots to tests/screenshots/<date>/. Close your tabs.

Out of scope

Editing recommendations from the web.

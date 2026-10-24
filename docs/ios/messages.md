Sync with the server

The server reaches the app in two ways: a silent push and the deliveries claim (shared/CONTRACT.md, "Recommendations and deliveries" and "Push notifications"). The app shows no notifications for either.

Silent push

- Every push from MOZOL is silent: `"aps": {"content-available": 1}`, no alert, no sound, no badge. There is no alert push and no notification service extension.
- The app registers for remote notifications at every launch, signed in or not. A silent push needs no notification permission.
- `mozol.type` "deliveries": the app claims and applies deliveries (below). "test": the app logs it, and Settings shows the time of the last test push.
- The device goes to the server with PUT /api/devices/:installationId after sign-in, on every launch, and whenever the APNs token or a permission changes. Settings shows the token and whether the server accepted it.
- Device testing with a TestFlight build: push-testing.md.

Claiming deliveries

- Triggers: a silent push, becoming active, every 60 seconds while open, Refresh, the background task, a shortcut. Every trigger goes through one event handler, AppEventHandler.
- One run claims (POST /api/deliveries/claim), applies the deliveries in Reminders (reminders.md) and reports the outcomes (POST /api/deliveries/results). Only one run at a time: a trigger during a run is dropped and logged.
- The app claims only while signed in and with full access to Reminders.
- A failed request is not retried. The next trigger tries again.
- In the background the app schedules a BGAppRefreshTask (`net.vrizo.mozol.refresh`) no earlier than 15 minutes ahead. iOS decides when it runs. Each run schedules the next one.

The app today (2026-10-24)

The app still fetches the old placeholder route GET /api/messages, sends the token with POST /api/devices, and shows raw payloads in the Inbox tab (entries in SwiftData, model InboxEntry, deleted at sign-out). It moves to the routes above (../product/pending.md).

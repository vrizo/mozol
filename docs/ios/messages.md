Sync with the server

The server reaches the app in two ways: a silent push and the deliveries claim (shared/CONTRACT.md, "Recommendations and deliveries" and "Push notifications"). The app shows no notifications for either, and sends no notifications at all.

Silent push

- Every push from MOZOL is silent: `"aps": {"content-available": 1}`, no alert, no sound, no badge. There is no alert push and no notification service extension.
- The app registers for remote notifications at every launch, signed in or not. A silent push needs no notification permission.
- `mozol.type` "deliveries": the app claims and applies deliveries (below). "test": the app logs it, and Settings shows the time of the last test push.
- The device goes to the server with PUT /api/devices/:installationId after sign-in, on every launch, and whenever the APNs token or the Reminders access changes. Settings shows the token and whether the server accepted it.
- Device testing with a TestFlight build: push-testing.md.

Claiming deliveries

- Triggers: a silent push, becoming active, every 60 seconds while open, Refresh, the background task, a shortcut. Every trigger goes through one event handler, AppEventHandler.
- One run claims (POST /api/deliveries/claim), applies the deliveries in Reminders (reminders.md) and reports the outcomes (POST /api/deliveries/results). Only one run at a time: a trigger during a run is dropped and logged.
- The app claims only while signed in and with full access to Reminders.
- A failed request is not retried. The next trigger tries again.
- In the background the app schedules a BGAppRefreshTask (`net.vrizo.mozol.refresh`) no earlier than 15 minutes ahead. iOS decides when it runs. Each run schedules the next one.

- A 401 unauthorized answer to the device registration or the claim means the app session ended on the server: the app signs out on this device only.

Placed screen

- The first tab lists what the app did with each delivery: the recommendation title, its kind, the outcome in plain words (or the failure code), and the time. Newest first.
- Records live in SwiftData (model DeliveryRecord, store Application Support/mozol.store). A delivery handed out again updates its record. Sign-out deletes them.
- The screen shows the time of the last successful run or the failure with its HTTP status. Without full access to Reminders it says so and links to the iOS Settings app.

Sign-in and sign-out

- Sign-in: shared/CONTRACT.md, "Sign-in handoff". The web view keeps no cookies (non-persistent website data), so every sign-in starts on the page.
- Sign-out: DELETE /api/devices/:installationId, then POST /api/auth/sign-out, then the session and the records are deleted on the phone. A failed server call is logged and does not stop the sign-out. The installation id stays.

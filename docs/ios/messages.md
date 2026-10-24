Messages from the server

The server sends data to the app in two ways: silent pushes and the messages route. The data format is not decided yet (product/pending.md), so the app stores and shows every payload as raw text in the Inbox tab.

Silent push

- The app registers for remote notifications at every launch, signed in or not. A silent push needs no notification permission.
- A silent push has `"aps": {"content-available": 1}` and no alert. The rest of the payload is the server's data.
- On a silent push the app stores the whole payload as one Inbox entry (source "push"), then fetches messages.
- Device testing with a TestFlight build: push-testing.md.
- The device token goes to the server with `POST /api/devices` after sign-in and whenever iOS reports a different token. Settings shows the token and whether the server accepted it.

Fetching messages

- `GET /api/messages?after=<cursor>` (shared/CONTRACT.md). Each message in the answer becomes one Inbox entry (source "server"). A message id that is already stored is skipped. The cursor from the answer is stored and sent with the next request.
- The app fetches while it is open: once when it becomes active, then every 60 seconds, and when the user taps Refresh.
- In the background the app schedules a BGAppRefreshTask (`net.vrizo.mozol.refresh`) no earlier than 15 minutes ahead. iOS decides when it runs. Each run schedules the next one.
- Only one fetch runs at a time. A trigger that comes during a fetch is dropped and logged.
- A failed fetch is not retried. The next trigger tries again. The Inbox shows the last result: the time of the last success, or the failure with its HTTP status.
- The app fetches only while signed in.

Every trigger (push, timer, becoming active, Refresh, background task, shortcut) goes through one event handler, AppEventHandler.

Inbox

- One row per entry: source, receive time, the first line of the body. Newest first.
- The entry screen shows the full body, pretty-printed when it is JSON, with a Copy button.
- Entries are stored in SwiftData (model InboxEntry) and stay until sign-out. Sign-out deletes them and the cursor.

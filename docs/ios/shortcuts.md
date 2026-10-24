Shortcuts

The app has an App Intents skeleton for a future Shortcuts action, in ios/Mozol/Intents/.

- CheckMessagesIntent sends the event `shortcut` to AppEventHandler, the same handler that push and fetch use (messages.md). For now the event only claims deliveries.
- The intent is hidden: `isDiscoverable = false`, and there is no AppShortcutsProvider. It does not appear in the Shortcuts app.
- Now: the shortcut only syncs. The app sends no notifications at all; recommendations reach the user only through Apple Reminders. The backend sends only silent pushes.
- Future: a personal automation runs the MOZOL shortcut when the user opens Instagram. Only then, when the shortcut was called, the app shows a notification with a hint. The app shows no notification in any other case. Details are open (../product/pending.md).

Shortcuts

The app has an App Intents skeleton for a future Shortcuts action, in ios/Mozol/Intents/.

- CheckMessagesIntent sends the event `shortcut` to AppEventHandler, the same handler that push and fetch use (messages.md). For now the event only claims deliveries.
- The intent is hidden: `isDiscoverable = false`, and there is no AppShortcutsProvider. It does not appear in the Shortcuts app.
- First version: the shortcut only syncs. The app shows no notifications at all; recommendations reach the user only through Apple Reminders.
- Second version: the app shows a notification with a hint, and only as part of a Shortcuts flow: a personal automation runs the MOZOL shortcut when the user opens another app, and the shortcut shows the hint. Details are open (../product/pending.md).

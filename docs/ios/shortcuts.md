Shortcuts

The app has an App Intents skeleton for a future Shortcuts action, in ios/Mozol/Intents/.

- CheckMessagesIntent sends the event `shortcut` to AppEventHandler, the same handler that push and fetch use (messages.md). For now the event only fetches messages.
- The intent is hidden: `isDiscoverable = false`, and there is no AppShortcutsProvider. It does not appear in the Shortcuts app.
- What the shortcut does is an open question (product/pending.md).

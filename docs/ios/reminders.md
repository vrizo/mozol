Reminders

The app writes to the user's Apple Reminders (the system Reminders app) through EventKit. It shows no reminders itself: the app has no Reminders screen. What it writes and when: tips.md.

- Access: full access to Reminders (iOS 17 `requestFullAccessToReminders`), asked on the Permissions screen (permissions.md).
- RemindersStore in ios/Mozol/Reminders/ reads the open reminders of all lists, and adds, changes and deletes reminders. It has no UI.
- A due date also sets an alarm at that time, so the Reminders app notifies.
- Without full access every RemindersStore call fails with `noAccess`. Nothing is retried.
- Logs carry counts and EventKit identifiers only, never titles or notes.

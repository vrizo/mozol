Reminders

The app writes to the user's Apple Reminders (the system Reminders app) through EventKit. It shows no reminders itself: the app has no Reminders screen. What it writes comes from deliveries (shared/CONTRACT.md, "How the app applies a delivery"; product rules: ../product/reminders.md).

- Access: full access to Reminders (iOS 17 `requestFullAccessToReminders`), asked on the Permissions screen (permissions.md).
- RemindersStore in ios/Mozol/Reminders/ reads the reminders of all lists, and adds and changes reminders. It has no UI.
- There is no MOZOL list. The app works with all of the user's reminders. A new reminder goes to the user's default list for new reminders (`defaultCalendarForNewReminders`, set in the Reminders app).
- A due date also sets an alarm at that time, so the Reminders app notifies. The app itself shows no notifications (messages.md).
- Without full access the app does not claim deliveries; they wait on the server. Every RemindersStore call fails with `noAccess`. Nothing is retried.
- Logs carry counts, markers, outcomes and EventKit identifiers only, never titles or notes.

Hidden tags

The app finds what it wrote earlier by a hidden tag. A tag carries the delivery's marker (8 hex characters) and is invisible in the Reminders app.

- A tag starts with the MOZOL mark: U+2063 U+200B U+2063.
- Then the 8 marker characters follow, each hex digit written as two invisible characters (base 4, high digit first): 0 = U+200C, 1 = U+200D, 2 = U+2060, 3 = U+2064. Example: the hex digit "b" (11) is 2 then 3, U+2060 U+2064.
- A tag is 19 characters long: 3 for the mark and 16 for the marker.

Where tags go:

- A line the app adds to a reminder of the user (steps embedded and embed_updated): embedLine followed directly by the tag, on one line.
- A reminder the app creates (steps created and reminder_updated): the tag stands alone as the last line of its notes. Notes become `<notes>\n<tag>`; empty notes become the tag alone.

How the app reads them:

- The app looks for the mark in every line of the title and notes, and decodes the 16 characters after it. A mark that is not followed by 16 valid characters is ignored; the app logs the count.
- A notes line that holds only a tag (spaces around it do not count) means the app created this reminder.
- A line with text before the tag is a line the app added.
- Lines with a tag are left out when the app scores a reminder against match terms (step embedded).
- A reminder the app created never receives lines for other markers.
- When the user deletes a tag, the app no longer knows that placement. The next delivery of the same item is placed again from step embedded.

Failed deliveries

A delivery that cannot be applied is reported as failed with one of these codes: `reminders_access` (no full access while applying), `no_default_list` (the Reminders app has no default list), `eventkit_save` (EventKit refused the save; the EventKit error code goes to the log).

Open check on a device: that the tag characters survive iCloud sync to another device and edits of the reminder in the Reminders app (../product/pending.md).

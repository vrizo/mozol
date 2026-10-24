Pending decisions

Questions waiting on Vitalii and Petr. Each answer moves into the matching spec file and leaves this list.

- Password reset needs a way to send email; there is none yet.
- Surfaces: the first version uses only items in Apple Reminders; every push is silent. The second version adds hint notifications inside a Shortcuts flow (../ios/shortcuts.md): which apps trigger it and what a hint shows. Widgets, Live Activities and the lock screen are open.
- When an item counts as learned: the user marks patterns as learned and words as known in the web app. Whether the app should also report completed MOZOL reminders (without their content).
- Do the hidden tags (../ios/reminders.md) survive iCloud sync to another device and edits in the Reminders app? Vitalii tests it on a device.
- Apple asks apps to get the user's confirmation before they change the Calendar database. MOZOL adds lines to the user's own reminders, so the iOS onboarding needs one clear consent step for that, besides the profile setting embedInMyReminders.
- Match terms with the substring mode (languages written without spaces) and very short words can match too much. The rules may need tuning after real use.
- APNs from the deployed worker: Cloudflare says production Workers reach APNs over HTTP/2 through its proxy, but does not document it. The first real push must be tested early. If it fails, the push sender moves to a Cloudflare Container or to AWS SNS.
- Next sources after Jamie: a Telegram bot, Slack, or a personal email address per user through Cloudflare Email Routing (for written language).
- Jamie sends no new event after the user renames speakers. The webhook's metadata.id is the meeting id of the Jamie API, so a personal API key could fetch the meeting again (meetings.get). Its transcript there is one Markdown string, not a list. Whether MOZOL needs this.
- Jamie's Speaker -1 (../backend/sources/jamie.md) has no participant, and its turns may hold several voices. Today the rule "the only speaker" picks it when it is the only speaker, and "Which speaker are you?" offers it. Whether Speaker -1 is only context, and what a transcript with nothing but Speaker -1 turns becomes.
- Jamie's docs do not say whether a retried delivery is signed again. The signature check accepts a timestamp up to 2 hours old so that the 1-hour retry passes. When Jamie re-signs retries, the window can go down to Jamie's 300 seconds.
- What the Shortcuts action does (../ios/shortcuts.md).
- Repetition schedule: how often an item comes back, and when it counts as learned.
- The iOS app follows shared/CONTRACT.md and is checked against scripts/stub-api.mjs only. It is checked again against the worker after B04 (sign-in), B05 (devices) and B09 (deliveries), and against the real /app/signin page after W02.
- Analytics: whether to use PostHog, as nobardak does.

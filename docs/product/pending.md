Pending decisions

Questions waiting on Vitalii and Petr. Each answer moves into the matching spec file and leaves this list.

- iOS bundle id and log subsystem (placeholder: app.mozol). Created later.
- Password reset needs a way to send email; there is none yet.
- Vitalii confirms the iOS side of the sign-in handoff (shared/CONTRACT.md).
- Surfaces in the first version: the specs cover items in Apple Reminders and alert pushes. Widgets, Live Activities and the lock screen are open.
- When an item counts as learned: the user marks patterns as learned and words as known in the web app. Whether the app should also report completed MOZOL reminders (without their content).
- Can the iOS notification service extension read and write Reminders with EventKit using the app's permission? Apple does not document it; Vitalii tests it on a device. If it cannot, the app applies deliveries when a background push wakes it or when the user opens it.
- Apple asks apps to get the user's confirmation before they change the Calendar database. MOZOL adds lines to the user's own reminders, so the iOS onboarding needs one clear consent step for that, besides the profile setting embedInMyReminders.
- Match terms with the substring mode (languages written without spaces) and very short words can match too much. The rules may need tuning after real use.
- APNs from the deployed worker: Cloudflare says production Workers reach APNs over HTTP/2 through its proxy, but does not document it. The first real push must be tested early. If it fails, the push sender moves to a Cloudflare Container or to AWS SNS.
- Next sources after Jamie: a Telegram bot, Slack, or a personal email address per user through Cloudflare Email Routing (for written language).
- Jamie sends no new event after the user renames speakers, and its webhook carries no meeting id for the Jamie API. Whether MOZOL needs a way to fetch a meeting again.
- Jamie's docs do not say whether a retried delivery is signed again. The signature check accepts a timestamp up to 2 hours old so that the 1-hour retry passes. When Jamie re-signs retries, the window can go down to Jamie's 300 seconds.
- The iOS app's local base URL: the contract uses http://localhost:5190 for pages and API (the web dev server passes /api to the worker). scripts/start-all.sh starts the simulator app with http://localhost:8790 today.
- Analytics: whether to use PostHog, as nobardak does.

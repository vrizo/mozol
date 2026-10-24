Reminders

MOZOL puts what the user should learn into the Apple Reminders app on the user's iPhone. The worker turns every analysis item into a recommendation and sends the best ones to the phone. The iOS app decides where each one goes, with EventKit: into one of the user's own reminders that mentions the same word or phrase, or into a new reminder. The user meets them in the Reminders app and in its alerts, again and again.

The worker never reads, receives or stores the user's reminders. Everything the app needs to place a recommendation comes with it: an item key, a marker, match terms and ready texts. Shapes and the exact algorithm: shared/CONTRACT.md ("Recommendations", "Text normalization", "How the app applies a delivery").

Recommendations

- Every analysis item becomes one recommendation: a mistake (finding), a word, a phrase or a rewrite.
- One recommendation becomes one reminder, or one line in a reminder of the user.
- Explanations are in the user's native language. Examples, corrections, words and phrases are in the conversation language.
- A recommendation carries:
  - an item key: the same mistake, word or phrase has the same key in every transcript;
  - a marker made from the item key. The app keeps it hidden in the reminder or line it writes, as a tag of invisible characters (../ios/reminders.md), and finds earlier placements of the same item by it;
  - match terms: words, word stems and phrases in the conversation language and in the native language that a person might write in a reminder about the same thing;
  - the title and notes of a new MOZOL reminder, and one short line to add to a reminder of the user;
  - a link to the recommendation in the web app, also used as the URL of a new MOZOL reminder.
- Fixed wording follows ../rules/ui-copy.md.

What goes to the phone

- Every recommendation of an analysis goes to the phone, so the number of reminders follows the number of the user's mistakes. Dismissed patterns, and words marked known or dismissed, are left out. The user can send any recommendation to the phone again from the web app.
- Delivery order: high-severity mistakes, mistakes of recurring patterns, words, rewrites, medium-severity mistakes, phrases, low-severity mistakes. Inside each group, the model's order.
- A recurring mistake goes again each time it appears. On the phone it updates its earlier placement instead of adding a second one.

Where the app puts a recommendation

The app tries these steps in order, and the first that fits wins:

1. A reminder of the user already holds a line with this marker: the app replaces that line with the new one.
2. A reminder that the app created holds this marker: the app updates it and makes it active again with a new due time.
3. A reminder of the user mentions one of the match terms: the app adds the line to its notes. The best match wins (most matched terms, then the most recently changed reminder).
4. Otherwise the app creates a new reminder in the user's default list.

Steps 1 and 3 run only when the profile setting embedInMyReminders is on (default on). There is no MOZOL list: the app works with all of the user's reminders. It uses incomplete reminders of all lists for steps 1 and 3, and every reminder it created, completed or not, for step 2.

Schedule of a new or updated MOZOL reminder

- The due time is at least 2 hours after the app received the recommendation, inside the user's active hours (default 09:00 to 21:00). Active hours are read in the phone's current time zone; the worker knows no time zone. A time outside the active hours moves to the start of the next active period.
- Repeat intensity, from the profile: light (every 3 days, 3 times), normal (every day, 5 times, the default) or intense (every day, 10 times).
- Priority: high for a high-severity mistake or a mistake of a recurring pattern, otherwise medium.
- A line added to a reminder of the user changes nothing else in that reminder.

Delivery

A recommendation sent to the phone gets a delivery. The worker pushes the user's devices; the app claims the waiting deliveries, applies them and reports each outcome: embed_updated, reminder_updated, embedded or created. Each delivery is applied by one device only. The worker keeps the outcome, never the reminder. A new delivery replaces a waiting one with the same marker. Worker side: ../backend/pipeline.md.

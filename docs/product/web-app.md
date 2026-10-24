Web app

The web app at https://mozol.vrizo.net is where the user signs up, connects sources and reads analyses. It also opens inside the iOS app for sign-in. Code rules: ../web/rules.md. Wording: ../rules/ui-copy.md.

Screens

- Home (/): the intro animation with links to sign up and sign in. A signed-in user sees a link to Activity.
- Sign up (/signup) and Sign in (/signin). Fields: accounts.md.
- App sign-in (/app/signin?return=mozol://auth): sign up or sign in, then hand the session to the iOS app (accounts.md). Without a valid return address the page shows an error.
- Activity (/activity): transcripts, newest first, with source, title, date and status. A transcript with status needs_speaker shows "Which speaker are you?" with each speaker's first lines. The list refreshes every 5 seconds while a transcript is queued or analyzing.
- Transcript (/activity/<id>): the conversation language, the summary, findings grouped by category with quotes and corrections, words, phrases, rewrites, and the recommendations with their delivery state. Actions: send a recommendation to the phone, analyze again, change speaker, delete.
- Patterns (/patterns): the user's patterns, recurring first, with language, counts, sources and last seen date, filtered by status and language. Actions: mark as learned, dismiss, make active again.
- Words (/words): suggested words with language, translation, meaning and example, filtered by status (new, learning, known, dismissed) and language. Action: move a word to another status.
- Sources (/sources): the user's connections with status and last event, and buttons to connect a source. Connecting Jamie shows the webhook URL with a copy button and the setup steps in Jamie. Webhook JSON shows the URL and a sample request.
- Paste (/sources/paste): a text box for a transcript or a text, with an optional title and date. Sending it opens the new transcript.
- Connection (/sources/<id>): label, webhook URL, the last 20 events, and actions: replace URL, pause or resume, delete. For Jamie it also takes the optional signing secret.
- Recommendation (/r/<id>): one recommendation with its texts, match terms and delivery state. A MOZOL reminder's URL opens this page.
- Recommendations (/recommendations): recommendations sent to the phone and the ones not sent, newest first, with the delivery state and outcome (added to a reminder of the user, updated, new reminder), and the user's devices with their last contact and a test push button.
- Profile (/profile): the profile fields (accounts.md), reminder settings, sign out, delete account.

Every screen that needs a session sends a signed-out user to Sign in, and back to the screen after sign-in.

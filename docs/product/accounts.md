Accounts

A user signs up and signs in on the web app with an email and a password. The iOS app signs in through the same web pages and then keeps its own session. API shapes: shared/CONTRACT.md.

Sign-up fields

- Email. Stored in lowercase. One account per email.
- Password, at least 10 characters.
- Display name.
- Native language: a BCP 47 language code, for example "ru". Any language. The languages the user learns are found in each transcript (analysis.md).

MOZOL keeps no time zone. Times in the web app use the browser's time zone; the iOS app schedules reminders in the phone's time zone (reminders.md).

Profile

The user can change every sign-up field except the email, and can also set:

- Your names (API field speakerNames): the names under which the user appears in meeting transcripts, for example "Petr" and "Petr S.". Sign-up puts the display name here. MOZOL uses them to find the user's turns: sources.md.
- Reminder settings (reminders.md): whether the app may add recommendations to the user's own reminders, repeat intensity and active hours.

Sessions

- The web app keeps its session in an HttpOnly cookie named mozol_session. A web session lasts 30 days from its last use.
- The iOS app keeps an app session token in the Keychain and sends it as a bearer token. An app session lasts 365 days from its last use.
- A session token is 32 random bytes. The database keeps only its SHA-256 hash.
- Signing out ends the current session only.
- Passwords are stored as PBKDF2-SHA256 hashes: 100,000 iterations, a random 16-byte salt per user.
- Sign-up and sign-in are rate limited per IP address.

Signing in from the iOS app

The app opens https://mozol.vrizo.net/app/signin?return=mozol://auth in a web view inside the app, not in the system browser. The user signs up or signs in on that page, and the page hands a one-time code to the app through the mozol:// address. The app exchanges the code for an app session token and registers its device and push token. A code works once and expires after 2 minutes. Any return address that does not start with mozol:// is refused. Steps: shared/CONTRACT.md, "Sign-in handoff".

Deleting an account

The user deletes the account from the profile page by typing the password again. This deletes the user and every row that belongs to the user: sessions, devices, connections, events, transcripts, analyses, patterns, words, recommendations and deliveries. Everything already placed on the phone stays in the Reminders app.

In the iOS app the sign-in screen has one button that opens /app/signin in a web view; sign-up is on the same page. Password AutoFill works there through the associated domain webcredentials:mozol.vrizo.net. Until the worker and the web app have these routes, local runs use scripts/stub-api.mjs (../ios/testing.md).

Accounts

- An account is an email and a password.
- A person creates an account on the MOZOL website, from a computer or from a phone.
- The iOS app signs in with the email and the password. Its sign-in screen has a "Create Account" button that opens the website's sign-up page (/signup) in a web view inside the app. The app has no sign-up form of its own.
- The iOS app and the web app use the same account and the same data.
- The iOS sign-in screen starts with the email of the last sign-in, also after sign-out. A clear button in the email field empties it.
- Password AutoFill: the fields are marked as username and password, and the app has the associated domain `webcredentials:mozol.vrizo.net`. A password saved on the website is offered in the app, and the other way round. This needs the apple-app-site-association file on mozol.vrizo.net (shared/CONTRACT.md).

Status on 2026-10-24: the server has no sign-in yet, and the website has no sign-up page. The iOS app uses a local placeholder: it accepts any email that has the shape name@domain and any non-empty password, and stores the token "placeholder" in the Keychain. The sign-in screen says that sign-in is not connected to the server. Server sign-in replaces the placeholder behind the same AuthService protocol.

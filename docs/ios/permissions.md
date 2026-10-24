Permissions

- The app asks for one permission: full access to Reminders. After the first sign-in the app shows one Permissions screen; its "Continue" button asks for it. Then the main tabs appear. The screen is shown once per install.
- The app does not ask for notifications. It sends no notifications of its own; reminder alerts come from the Reminders app. The backend sends only silent pushes, and silent pushes need no permission (messages.md). Remote notification registration does not wait for the Permissions screen.
- A later version may show a notification when the user opens Instagram, through a Shortcuts automation (shortcuts.md). It will ask for the notification permission then.
- Settings shows the current state of the Reminders access and has an "Open Settings" button for the iOS Settings app.
- Permission alert texts live in ios/Mozol/Resources/InfoPlist.xcstrings.

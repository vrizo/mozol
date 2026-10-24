Permissions

- After the first sign-in the app shows one Permissions screen. Its "Continue" button asks for notifications (alert, sound, badge), then for full access to Reminders, one after the other. Then the main tabs appear. The screen is shown once per install.
- Remote notification registration does not wait for this screen: silent pushes need no permission (messages.md).
- The first version shows no notifications of its own; reminder alerts come from the Reminders app. The notification permission is asked now for the hint notifications of the second version (shortcuts.md).
- Settings shows the current state of both permissions and has an "Open Settings" button for the iOS Settings app.
- Permission alert texts live in ios/Mozol/Resources/InfoPlist.xcstrings.

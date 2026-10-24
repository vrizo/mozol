UI copy

Rules for user-facing strings: iOS app, web app, reminder texts, worker messages.

- One UI language: English.
- The product name is written "MOZOL" everywhere a user sees it. Identifiers in code, file names and domains stay lowercase (mozol-api, mozol.vrizo.net).
- iOS strings live in ios/Mozol/Resources/Localizable.xcstrings, the permission-alert texts in InfoPlist.xcstrings. A string built as a plain String uses String(localized:). Plurals use catalog variations, never a suffix built in code.
- Web strings live in web/src/copy/en.ts, one object, no strings inline in components.
- Worker strings that reach a user live in worker/src/copy.ts.
- Plain words, short. Tell the user what happened and what to do next.
- A failure names the thing that failed in plain words. A backend failure adds its code and nothing else ("Couldn't load your words: error 6"). Module and type names never reach the user.
- A button that leads to a system permission prompt reads "Continue". Never "Allow", "Enable", "Grant" or "Turn on", and no copy on that screen tells the reader which answer to give (App Review guideline 5.1.1(iv)).
- Never join phrases with the middle dot "·" — use a comma or separate lines.
- The main session does not write user-facing strings itself: a separate subagent writes them, following this file.

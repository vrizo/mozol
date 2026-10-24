Tips in reminders

A tip is a short piece of advice from the server about one mistake the user makes when they speak. Example: the user says "der Laptop", the correct form is "das Laptop". The app puts each tip into the user's Apple Reminders (reminders.md), so the advice is in front of the user's eyes next to things they already read.

Where tips come from

- The server builds tips from transcripts of the user's speech. The server side is specified in shared/CONTRACT.md when it is ready.
- A tip reaches the app in a silent push (messages.md). The push carries the whole tip object.
- A tip object has these fields:
  - `id` — unique per tip.
  - `rule` — the mistake category, for example `article_gender` or `past_sentence_order`.
  - `advice` — the text for the user, one or two short sentences. Example: "It is das Laptop, not der Laptop."
  - `keywords` — a list of words or short phrases the tip is about. Example: ["Laptop"].
- The app applies each tip id once. A tip id that is already stored is skipped.
- A tip with a new id is applied even when a tip with the same rule was applied before.

Finding matching reminders

- The app searches the title and the notes of every reminder that is not completed, in all lists.
- Text is compared after normalization: lowercase, diacritics removed (ä becomes a, ß becomes ss), punctuation turned into spaces, split into words.
- A keyword word matches a reminder word when one of these is true:
  - the words are equal;
  - the reminder word starts with the keyword word, and the keyword word has 4 or more letters (Laptop matches Laptops);
  - the edit distance is 1 for keyword words of 4 to 7 letters, or 2 for 8 or more letters (Laptop matches Labtop). Edit distance is the number of single-letter changes, insertions or deletions that turn one word into the other.
- A keyword of several words matches when all its words match reminder words that stand next to each other, in the same order.
- Keyword words shorter than 4 letters match only when equal.
- The score of a reminder is the number of the tip's keywords it matches. A reminder with score 0 does not match.
- A reminder that already carries the MOZOL mark (see below) is never a match.

Writing the tip

- The tip goes into one reminder: the one with the highest score. Equal scores: the reminder modified most recently wins.
- In that reminder the app adds the tip to the end of the notes, after an empty line: "MOZOL: <advice>", then the mark. The title, the list, the due date and the other fields stay as they are.
- When no reminder matches, the app creates one reminder in the default Reminders list. Title: the advice. Notes: the mark. No due date.

The MOZOL mark

- The mark is a fixed sequence of invisible Unicode characters: U+2063 U+200B U+2063. The user does not see it in the Reminders app.
- Every reminder the app edits or creates for a tip gets the mark. The app never edits a reminder with the mark again.
- When the user deletes the mark, the reminder counts as an ordinary reminder again.

When tips are applied

- Applying runs inside AppEventHandler (messages.md), after a silent push stores a tip, in the foreground and in the background.
- Each tip is stored in SwiftData with its state: waiting, applied, or failed with the error. An applied tip stores the EventKit identifier of the reminder it changed or created.
- A tip waits while the app has no full access to Reminders. Waiting tips are applied at the next trigger after access is given.
- A failed save is not retried. The tip stays failed, and the error is logged.
- Sign-out deletes the stored tips. Reminders the app already changed stay as they are.
- Logs carry tip ids, rules, scores, counts and EventKit identifiers only, never advice, keywords, titles or notes.

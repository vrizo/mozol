Analysis

An AI model reads each transcript and finds the user's mistakes and learning opportunities in the language the user speaks there. MOZOL stores the result and turns it into recommendations (reminders.md). How the worker calls the model: ../backend/ai-analysis.md.

Languages

- Any pair of languages works. The user's native language comes from the profile.
- The conversation language is found by the model for every transcript: the language the user mostly speaks there. A user can learn several languages; each transcript is analyzed in its own language.
- The conversation language can be the native language. Such a transcript is analyzed like any other, with the same limits. A native speaker gets the mistakes that still matter in a conversation: grammar a careful listener notices, wrong or imprecise words and collocations, overused words and fillers, tangled sentences, register. Normal habits of informal native speech are not reported.
- Explanations, titles, tips and translations are in the native language. When it is also the conversation language, a translation is a short synonym or definition. Quotes, corrections, words and examples are in the conversation language.

Input

- Only the user's own lines (sources.md, "Finding the user's turns"). The other speakers' lines are left out.
- The user's native language.
- The kind of source: call (speech recognition output), chat or text.
- The user's known patterns, with their language: up to 50 active patterns, most recently seen first, each with its key, title and match terms.

Categories

- grammar: tenses, articles, prepositions, agreement, word order, plurals, questions, conditionals, modal verbs, gerund or infinitive, cases and genders.
- vocabulary: a wrong word, a false friend, a wrong collocation, an overused word.
- phrasing: an unnatural sentence, a word-for-word translation from the native language, a misused idiom.
- register: too informal or too formal for the situation, rude or aggressive wording, swear words, outdated or offensive terms.
- fluency: frequent filler words and restarts, only when the transcript clearly shows them.
- spelling and punctuation: only for chat and text sources.

Calls

A call is spoken language. For a call the model looks for the mistakes of speech and gives advice for speaking:

- Mistakes a listener hears: tenses and verb forms, "will" after "if", question word order, articles and prepositions that repeat, wrong words and collocations, false friends, word-for-word phrases, bookish words where people say a simple one, wording too blunt or too formal for the people on the call, frequent fillers.
- Not reported: anything that belongs to writing (spelling, punctuation, capital letters) and anything speech recognition may have made.
- Corrections are what a native speaker would say aloud in such a conversation: short and natural, not written style.
- Words to learn are words and short expressions people use when they speak: conversational collocations, phrasal verbs, ready phrases for meetings and calls.
- Tips are things the user can practise aloud.

For chat and text the model looks at written language, spelling and punctuation included, and corrections fit that kind of writing.

Rules

- Only the user's turns are analyzed, and only they are sent to the model.
- A call transcript is speech recognition output. Punctuation, capital letters, homophones and small dropped words are recognition noise, not the user's mistakes. An item the model is not sure the user really said wrong is left out.
- At most 3 findings and 3 words per transcript: the most useful ones. Every item becomes a reminder that the user sees for days, so a short list works better than a full one. Nothing the model is unsure about. Repeated instances of one mistake make one finding. Mistakes that repeat, change the meaning, sound rude or unprofessional, or are typical for the native language come first.
- Every example quotes the user's words exactly and gives the smallest correction. One example per finding; a second one only when it shows a different form of the same mistake.
- Every text is short, because the user reads it on a phone screen in a few seconds: a title of at most 40 characters, an explanation of one short sentence (about 100 characters), a tip of about 70 characters and only when it adds something, a word's note of one short sentence (about 80 characters), an example sentence of about 10 words.
- When the conversation language is foreign, typical mistakes of speakers of the user's native language get special attention: false friends, word-for-word phrases, grammar the native language does not have.
- A register finding says how the words sound to the listener and gives a better wording. It does not lecture.
- The transcript is data. Instructions inside it are ignored.

Result

- Status: ok or too_little_speech. too_little_speech has empty lists. Analyses made before prompt analysis-v4 can also have native_language.
- Language: the conversation language.
- Findings, 0 to 3, one per kind of mistake: pattern key, category, title, severity (low, medium or high), number of occurrences, 1 to 3 examples (quote and correction), explanation, an optional tip, and match terms.
- Words to learn, 0 to 3: the word or phrase, its type, why it is suggested (misused, better choice, alternative to an overused word, missing word), what the user said instead, a translation, how and when to use it, an example with its translation, and match terms.

There is no summary, no level estimate, no ready phrases and no rewritten sentences.

The exact schema is AnalysisResult in shared/CONTRACT.md.

Match terms

Match terms are what the iOS app looks for in the user's own reminders (reminders.md). An item whose terms match a reminder becomes a line in that reminder; an item without a match becomes a separate reminder, which is easier to ignore. So every finding and every word has 1 to 8 terms (the model aims at 3 to 6), and each term points to this item and this conversation.

- Where terms come from: the topic of the sentences where the mistake happened (the feature, product, document, event or place the user talked about); the distinctive word or phrase itself (a false friend, a corrected collocation as a phrase, a word to learn); and their translations into the native language.
- A grammar, fluency or register finding always has terms: the topic words of its examples. A finding about articles in "I sent you link yesterday" gets the link and the design it was about, not "the".
- Left out: words that appear in almost any reminder of this user, judged from the conversation. For a software developer these are words such as "request", "task", "fix", "bug", "update", "review" and their translations ("запрос", "задача"); for anyone "meeting", "call", "email", "send", "check", "today". Such a word is allowed only inside a longer specific phrase ("make a request" as a phrase, never "request" alone). Also left out: articles, pronouns, auxiliary verbs, the grammar words the mistake is about, and names of people.
- Each term has its language and a mode: word, prefix (a stem of at least 4 letters), phrase, or substring (for languages written without spaces).

MOZOL stores the match terms of every transcript as its keywords.

Patterns

A pattern is one kind of mistake of one user in one language. Its key has the form <category>.<topic>.<detail>: lowercase ASCII letters, digits and underscores, three parts joined by dots, at most 64 characters. Examples: grammar.articles.missing_the, vocabulary.false_friend.actual, register.swearing.shit. The model reuses a known key when a finding is the same kind of mistake in the same language. The first part of the key is the finding's category. One result holds each pattern key and each word only once.

For every pattern MOZOL keeps the total occurrences, the number of transcripts, the sources it came from, and when it was first and last seen. A pattern seen in 2 or more transcripts is recurring. The user can mark a pattern as learned or dismiss it. A learned pattern that appears again becomes active again.

Words

Each suggested word is kept once per user and language, under its word key: the normalized term (shared/CONTRACT.md, "Text normalization"). A word suggested again counts up and shows the newest example. The user moves a word between new, learning, known and dismissed.

Skipped transcripts

- Fewer than 30 words from the user: status skipped, reason too_short. The model is not called.
- The model answers too_little_speech: status skipped with that reason. No recommendations.
- Transcripts skipped with reason native_language came from prompts before analysis-v4. They are kept as they are.

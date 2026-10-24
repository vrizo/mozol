Sources

A source is a service that sends MOZOL what the user said or wrote, such as meeting transcripts. The user connects a source in the web app. MOZOL analyzes everything that arrives from it.

Connections

- A connection links one user to one source. A user can have several connections, also several to the same source.
- A connection that receives data by webhook has its own secret webhook URL: https://mozol.vrizo.net/api/hooks/<source>/<token>. The token is 32 random bytes in base64url (43 characters). The URL is the only key: whoever has it can send data into the user's account.
- The owner can copy the URL at any time, replace it with a new one (the old URL stops working at once), pause the connection (requests to it are refused) and delete it.
- The web app shows the last 20 events of a connection: time, outcome and error code.

Sources in the first version

- Jamie (id jamie): meeting transcripts from https://app.meetjamie.ai, sent by Jamie's webhook after each meeting. Setup and payload mapping: ../backend/sources/jamie.md.
- Paste (id paste): the user pastes a transcript or a text into the web app. Each line in the form "Name: text" is a turn of that speaker. A line without a name continues the previous turn. Text without any names is the user's own text. A paste with speaker names has kind call; a paste without names has kind text.
- Webhook JSON (id json): any tool that can send JSON, such as Zapier, Make, n8n or a script, posts the MOZOL transcript format from shared/CONTRACT.md.

Adding a source

A source is one adapter module in worker/src/sources/ plus one entry in the source registry there. The adapter checks the request and turns it into a normalized transcript (the columns of the transcripts table in ../backend/data-model.md), or refuses it with an error code. Nothing else in the worker knows a source's format. The registry also gives the web app the source's name, kind and setup steps.

Finding the user's turns

MOZOL analyzes only the user's own turns. The other speakers' turns are context. The worker picks the user's speaker in this order:

1. The speaker that the source names as the user: for Jamie, the participant whose email is the recorder's email; for the json source, the speaker in learnerSpeaker.
2. A speaker whose email is the user's account email.
3. A speaker whose name matches one of the user's speaker names. Matching ignores case, accents and extra spaces, and a speaker name also matches the first word of a longer name ("Petr" matches "Petr Shardakov"). When more than one speaker matches, the transcript waits for the user (below).
4. The only speaker, when the transcript has one.

When none of these works, the transcript waits with status needs_speaker. The web app shows each speaker with their first lines and asks "Which speaker are you?". The chosen speaker's name is saved as a speaker name, and the analysis starts.

Placeholder names are names a source gives to voices it does not know, for Jamie "Speaker 1", "Speaker 2". They are never saved as speaker names and never match one.

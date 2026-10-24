Jamie source

Jamie (https://app.meetjamie.ai) sends one webhook event, meeting.completed, when a meeting is fully processed. Official docs: https://docs.meetjamie.ai/developers/webhooks/getting-started. Webhooks need a Jamie Pro, Team or Enterprise plan.

Setup steps shown to the user

1. In Jamie open Settings, Developers, Webhooks, and choose Create Webhook.
2. URL: paste the MOZOL webhook URL of the connection.
3. Scope: Personal, so only the user's own meetings are sent.
4. Authentication: Signature. Jamie shows a signing secret once.
5. Paste the signing secret into the MOZOL connection page. This step is optional: without it the secret URL alone protects the connection.
6. Press Send Test Event in Jamie. The event appears in the connection's event list.

Request

- POST with Content-Type application/json and the headers jamie-event (meeting.completed), jamie-delivery (the delivery id) and, in signature mode, x-jamie-signature.
- x-jamie-signature has the form t=<unix seconds>,v0=<hex>. v0 is HMAC-SHA256 of "<t>.<raw body>" with the signing secret.
- When the connection has a signing secret, the worker checks the signature on the raw body before parsing it, with a constant-time comparison, and refuses a t older than 2 hours. A missing or wrong signature is refused with 401 signature_invalid.
- Jamie treats any 2xx answer within 30 seconds as delivered. Otherwise it tries again after 10 seconds, 1 minute, 10 minutes and 1 hour, so the same delivery can arrive more than once.
- An event other than meeting.completed is answered 200 with outcome ignored.

Body fields MOZOL reads

- metadata.id: the delivery id. Used as external_id, so a repeated delivery is a duplicate.
- data.title: the transcript title.
- data.startTime and data.endTime (ISO 8601; endTime can be null): occurred_at, and duration_sec when both exist.
- data.user.email: the email of the Jamie user who recorded the meeting.
- data.transcript[]: speakerId, speakerName, text. One segment per entry, in order. There are no times per segment.
- data.participants[]: id, name, email (can be null). participants[].id equals transcript[].speakerId.

The other fields (summary, event, tasks, tags) are kept only in the raw event body.

Mapping

- kind: call. language: null (Jamie does not send it).
- participants: one per data.participants entry; is_recorder is true for the participant whose email equals data.user.email, ignoring case.
- segments: speaker_id from speakerId, speaker_name from speakerName, text as sent; empty texts are dropped.
- A body without data.transcript, or with no segment that has text, is refused with 422 payload_invalid. The raw body stays in hook_events.
- Speaker names of the form "Speaker <number>" are placeholder names (../../product/sources.md).

Speakers Jamie does not know yet are named "Speaker 1", "Speaker 2". Jamie asks the user to name them after the meeting, and the webhook does not repeat the event after that. Such a transcript usually waits for "Which speaker are you?" (../../product/sources.md).

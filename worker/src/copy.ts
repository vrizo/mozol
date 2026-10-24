// Worker strings that reach a user (docs/rules/ui-copy.md).
export const copy = {
  sources: {
    jamie: {
      name: "Jamie",
      setupSteps: [
        "Webhooks need a Jamie Pro, Team or Enterprise plan. In Jamie, open Settings, Developers, Webhooks, and choose Create Webhook.",
        "In URL, paste the webhook URL of your MOZOL connection.",
        "In Scope, choose Personal. Jamie then sends only your own meetings.",
        "In Authentication, choose Signature. Jamie shows a signing secret only once.",
        "Paste the signing secret on the connection page in MOZOL. This step is optional: without it, the secret webhook URL alone protects the connection.",
        "In Jamie, press Send Test Event. The event appears in the event list of your connection.",
      ],
    },
    json: {
      name: "Webhook JSON",
      setupSteps: [
        "Copy the webhook URL of your MOZOL connection.",
        "Send a POST request to this URL with Content-Type application/json. Any tool that can send JSON works, such as Zapier, Make, n8n or a script.",
        'In the body, send "segments": the turns in order, each with "speaker" and "text".',
        'You can also send "id", "title", "occurredAt", "kind" and "learnerSpeaker". Put your own speaker name in "learnerSpeaker".',
        'If you send the same "id" again, MOZOL keeps only one copy.',
        "Check the event list of your connection. Each request appears there with its outcome.",
      ],
    },
    paste: {
      name: "Paste",
      setupSteps: [
        "Paste a transcript or your own text into the box.",
        'Write each turn on its own line as "Name: text". A line without a name continues the turn above.',
        "Text without any names counts as your own text.",
        "If you want, add a title and a date.",
      ],
    },
  },
} as const;

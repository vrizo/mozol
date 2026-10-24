// Webhook JSON: any tool that posts JsonSourceBody (shared/CONTRACT.md, "Endpoints: webhooks").
// A speaker's id is its name, so learnerSpeaker names the user's speaker id.
import { JsonSourceBody } from "shared";
import { copy } from "../copy";
import { parseJsonBody, type SourceAdapter, speakerParticipants } from "./types";

export const jsonAdapter: SourceAdapter = {
  id: "json",
  name: copy.sources.json.name,
  kind: "call",
  webhook: true,
  setupSteps: copy.sources.json.setupSteps,
  isPlaceholderName: () => false,

  parse(rawBody, _headers, context) {
    const json = parseJsonBody(rawBody);
    if (json === undefined) return { outcome: "refused", error: "bad_json" };
    const body = JsonSourceBody.safeParse(json);
    if (!body.success) return { outcome: "refused", error: "payload_invalid" };

    const segments = body.data.segments
      .filter((s) => s.text.trim() !== "")
      .map((s) => ({ speakerId: s.speaker, speakerName: s.speaker, text: s.text }));
    if (segments.length === 0) return { outcome: "refused", error: "payload_invalid" };

    return {
      outcome: "transcript",
      transcript: {
        externalId: body.data.id ?? null,
        kind: body.data.kind,
        title: body.data.title ?? null,
        occurredAt: body.data.occurredAt ?? context.receivedAt,
        durationSec: null,
        language: null,
        participants: speakerParticipants(segments),
        segments,
        learnerSpeakerHint: body.data.learnerSpeaker ?? null,
      },
    };
  },
};

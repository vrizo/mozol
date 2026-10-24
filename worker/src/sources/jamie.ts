// Jamie (https://app.meetjamie.ai): the meeting.completed webhook, its signature and its mapping
// (docs/backend/sources/jamie.md).
import { z } from "zod";
import { fromHex } from "../auth/bytes";
import { copy } from "../copy";
import { type NormalizedTranscript, parseJsonBody, type SourceAdapter } from "./types";

const PLACEHOLDER_NAME = /^Speaker -?\d+$/i;
const MAX_SIGNATURE_AGE_SECONDS = 2 * 3600;
const MEETING_COMPLETED = "meeting.completed";

const Instant = z.iso.datetime({ offset: true });

const EventOnly = z.object({ metadata: z.object({ event: z.string() }) });

// Only the fields MOZOL reads; the rest stays in the raw body of the hook event.
const MeetingCompleted = z.object({
  metadata: z.object({ id: z.string().min(1).max(200) }),
  data: z.object({
    title: z.string().nullish(),
    startTime: Instant,
    endTime: Instant.nullish(),
    user: z.object({ email: z.string() }),
    participants: z.array(z.object({ id: z.string().min(1), name: z.string(), email: z.string().nullish() })),
    transcript: z.array(
      z.object({ speakerId: z.string().min(1), speakerName: z.string(), text: z.string() }),
    ),
  }),
});

export const jamieAdapter: SourceAdapter = {
  id: "jamie",
  name: copy.sources.jamie.name,
  kind: "call",
  webhook: true,
  setupSteps: copy.sources.jamie.setupSteps,
  isPlaceholderName: (name) => PLACEHOLDER_NAME.test(name.trim()),
  verify: verifySignature,

  parse(rawBody, headers) {
    const json = parseJsonBody(rawBody);
    if (json === undefined) return { outcome: "refused", error: "bad_json" };
    const event = headers.get("jamie-event") ?? EventOnly.safeParse(json).data?.metadata.event;
    if (event !== MEETING_COMPLETED) return { outcome: "ignored" };

    const body = MeetingCompleted.safeParse(json);
    if (!body.success) return { outcome: "refused", error: "payload_invalid" };
    const transcript = toTranscript(body.data);
    if (transcript.segments.length === 0) return { outcome: "refused", error: "payload_invalid" };
    return { outcome: "transcript", transcript };
  },
};

function toTranscript(body: z.output<typeof MeetingCompleted>): NormalizedTranscript {
  const { data } = body;
  const recorderEmail = data.user.email.trim().toLowerCase();
  const start = Date.parse(data.startTime);
  const end = data.endTime ? Date.parse(data.endTime) : null;
  return {
    externalId: body.metadata.id,
    kind: "call",
    title: data.title ? data.title : null,
    occurredAt: new Date(start).toISOString(),
    durationSec: end === null ? null : Math.max(0, Math.round((end - start) / 1000)),
    language: null,
    participants: data.participants.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email ?? null,
      isRecorder: recorderEmail !== "" && p.email?.trim().toLowerCase() === recorderEmail,
    })),
    segments: data.transcript
      .filter((s) => s.text.trim() !== "")
      .map((s) => ({ speakerId: s.speakerId, speakerName: s.speakerName, text: s.text })),
    learnerSpeakerHint: null,
  };
}

// x-jamie-signature: "t=<unix seconds>,v0=<hex>", v0 = HMAC-SHA256 of "<t>.<raw body>" with the signing secret.
// crypto.subtle.verify compares in constant time.
async function verifySignature(
  rawBody: string,
  headers: Headers,
  connection: { signingSecret: string },
): Promise<boolean> {
  const header = headers.get("x-jamie-signature");
  if (header === null) return false;
  const parts = header.split(",").map((part) => part.trim().split("="));
  const t = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v0").map(([, value]) => fromHex(value ?? ""));
  if (t === undefined || !/^\d{1,12}$/.test(t)) return false;
  if (Date.now() / 1000 - Number(t) > MAX_SIGNATURE_AGE_SECONDS) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(connection.signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = encoder.encode(`${t}.${rawBody}`);
  for (const signature of signatures) {
    if (signature !== null && (await crypto.subtle.verify("HMAC", key, signature, signed))) return true;
  }
  return false;
}

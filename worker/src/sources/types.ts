// The normalized transcript every source adapter makes, and the adapter interface (docs/product/sources.md).
import type { SourceId, SourceKind } from "shared";

export type Participant = { id: string; name: string; email: string | null; isRecorder: boolean };

export type Segment = { speakerId: string; speakerName: string; text: string };

export type NormalizedTranscript = {
  externalId: string | null;
  kind: SourceKind;
  title: string | null;
  occurredAt: string;
  durationSec: number | null;
  language: string | null;
  participants: Participant[];
  segments: Segment[];
  // The speaker id the source names as the user, such as the json source's learnerSpeaker.
  learnerSpeakerHint: string | null;
};

export type ParseError = "bad_json" | "payload_invalid";

export type ParseResult =
  | { outcome: "transcript"; transcript: NormalizedTranscript }
  | { outcome: "ignored" }
  | { outcome: "refused"; error: ParseError };

// receivedAt: the default time of a transcript; userName: the speaker of text without speaker names.
export type ParseContext = { receivedAt: string; userName: string };

export type SourceAdapter = {
  id: SourceId;
  name: string;
  kind: SourceKind;
  webhook: boolean;
  setupSteps: readonly string[];
  // Names a source gives to voices it does not know. They never match and are never saved.
  isPlaceholderName(name: string): boolean;
  // Checks the signature of a webhook request; called only when the connection has a signing secret.
  verify?(rawBody: string, headers: Headers, connection: { signingSecret: string }): Promise<boolean>;
  parse(rawBody: string, headers: Headers, context: ParseContext): ParseResult;
};

// The parsed body, or undefined when it is not valid JSON.
export function parseJsonBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return undefined;
  }
}

// One participant per speaker, in order of the first turn, for sources that know only speaker names.
export function speakerParticipants(segments: Segment[]): Participant[] {
  const participants = new Map<string, Participant>();
  for (const { speakerId, speakerName } of segments) {
    if (!participants.has(speakerId)) {
      participants.set(speakerId, { id: speakerId, name: speakerName, email: null, isRecorder: false });
    }
  }
  return [...participants.values()];
}

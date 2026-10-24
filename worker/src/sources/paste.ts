// Paste: a transcript or the user's own text, sent from the web app (docs/product/sources.md).
// A line "Name: text" starts a turn of that speaker; a line without a name continues the turn above it.
// Text before the first name, and text without any names, is the user's own: its speaker is the user's name.
import { PasteTranscriptBody } from "shared";
import { copy } from "../copy";
import {
  type NormalizedTranscript,
  type ParseContext,
  parseJsonBody,
  type SourceAdapter,
  speakerParticipants,
} from "./types";

// A name is 1..80 characters without a colon, with at least one letter, followed by ":" and a space or the
// line end, so times ("10:30") and links ("https://") are not names.
const NAMED_LINE = /^([^:\s][^:]{0,79}?)\s*:(?:\s+(.*))?$/u;
const LETTER = /\p{L}/u;

export const pasteAdapter: SourceAdapter = {
  id: "paste",
  name: copy.sources.paste.name,
  kind: "text",
  webhook: false,
  setupSteps: copy.sources.paste.setupSteps,
  isPlaceholderName: () => false,

  parse(rawBody, _headers, context) {
    const json = parseJsonBody(rawBody);
    if (json === undefined) return { outcome: "refused", error: "bad_json" };
    const body = PasteTranscriptBody.safeParse(json);
    if (!body.success) return { outcome: "refused", error: "payload_invalid" };
    const transcript = pasteTranscript(body.data, context);
    if (transcript === null) return { outcome: "refused", error: "payload_invalid" };
    return { outcome: "transcript", transcript };
  },
};

// The transcript of a paste, or null when it has no text.
export function pasteTranscript(
  body: PasteTranscriptBody,
  context: ParseContext,
): NormalizedTranscript | null {
  const turns: { speaker: string; lines: string[] }[] = [];
  let named = false;
  for (const rawLine of body.text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const match = NAMED_LINE.exec(line);
    const name = match?.[1]?.replace(/\s+/g, " ");
    if (name !== undefined && LETTER.test(name)) {
      named = true;
      const text = match?.[2]?.trim() ?? "";
      turns.push({ speaker: name, lines: text === "" ? [] : [text] });
      continue;
    }
    const last = turns.at(-1);
    if (last === undefined) turns.push({ speaker: context.userName, lines: [line] });
    else last.lines.push(line);
  }

  const segments = turns
    .filter((turn) => turn.lines.length > 0)
    .map((turn) => ({ speakerId: turn.speaker, speakerName: turn.speaker, text: turn.lines.join("\n") }));
  if (segments.length === 0) return null;
  return {
    externalId: null,
    kind: named ? "call" : "text",
    title: body.title ?? null,
    occurredAt: body.occurredAt ?? context.receivedAt,
    durationSec: null,
    language: null,
    participants: speakerParticipants(segments),
    segments,
    learnerSpeakerHint: null,
  };
}

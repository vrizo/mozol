import meeting from "shared/fixtures/jamie/meeting-completed.json";
import realKnown from "shared/fixtures/jamie/real/meeting-completed-known-speakers.json";
import realUnknown from "shared/fixtures/jamie/real/meeting-completed-unknown-speakers.json";
import jsonTranscript from "shared/fixtures/json/transcript.json";
import pasteText from "shared/fixtures/paste/transcript.txt?raw";
import { describe, expect, it } from "vitest";
import { jamieAdapter } from "../src/sources/jamie";
import { jsonAdapter } from "../src/sources/json";
import { pasteTranscript } from "../src/sources/paste";
import type { NormalizedTranscript, ParseResult } from "../src/sources/types";
import { jamieSignature } from "./hooks-helpers";

const CONTEXT = { receivedAt: "2026-10-24T12:00:00.000Z", userName: "Petr" };
const NO_HEADERS = new Headers();

function transcriptOf(result: ParseResult): NormalizedTranscript {
  if (result.outcome !== "transcript")
    throw new Error(`expected a transcript, got ${JSON.stringify(result)}`);
  return result.transcript;
}

describe("the Jamie adapter", () => {
  const raw = JSON.stringify(meeting);

  it("maps meeting.completed", () => {
    const t = transcriptOf(
      jamieAdapter.parse(raw, new Headers({ "jamie-event": "meeting.completed" }), CONTEXT),
    );
    expect(t).toMatchObject({
      externalId: meeting.metadata.id,
      kind: "call",
      title: meeting.data.title,
      occurredAt: "2026-10-22T09:00:00.000Z",
      durationSec: 41 * 60 + 23,
      language: null,
      learnerSpeakerHint: null,
    });
    expect(t.segments).toHaveLength(meeting.data.transcript.length);
    expect(t.segments[2]).toEqual({
      speakerId: "2",
      speakerName: "Petr Ivanov",
      text: meeting.data.transcript[2]?.text,
    });
    expect(t.participants.filter((p) => p.isRecorder).map((p) => p.id)).toEqual(["2"]);
  });

  it("maps the real events, with the recorder or with Speaker -1 and no participants", () => {
    const known = transcriptOf(jamieAdapter.parse(JSON.stringify(realKnown), NO_HEADERS, CONTEXT));
    expect(known.externalId).toBe("1l73xk5glpgw");
    expect(known.participants.filter((p) => p.isRecorder).map((p) => p.name)).toEqual(["Vitalii Rizo"]);
    expect(known.segments).toHaveLength(10);

    const unknown = transcriptOf(jamieAdapter.parse(JSON.stringify(realUnknown), NO_HEADERS, CONTEXT));
    expect(unknown.participants).toEqual([]);
    expect(unknown.segments.map((s) => s.speakerId)).toEqual(["-1"]);
  });

  it("reads the event from the body when the header is missing, and ignores other events", () => {
    expect(jamieAdapter.parse(raw, NO_HEADERS, CONTEXT).outcome).toBe("transcript");
    expect(jamieAdapter.parse(raw, new Headers({ "jamie-event": "meeting.deleted" }), CONTEXT)).toEqual({
      outcome: "ignored",
    });
    const other = { ...meeting, metadata: { ...meeting.metadata, event: "meeting.updated" } };
    expect(jamieAdapter.parse(JSON.stringify(other), NO_HEADERS, CONTEXT)).toEqual({ outcome: "ignored" });
  });

  it("drops empty texts, takes offsets and a missing end time", () => {
    const body = structuredClone(meeting) as { data: Record<string, unknown> } & typeof meeting;
    body.data.startTime = "2026-10-22T11:00:00+02:00";
    body.data.endTime = null as unknown as string;
    body.data.transcript = [
      { speakerId: "0", speakerName: "Laura Bennett", text: "  " },
      { speakerId: "2", speakerName: "Petr Ivanov", text: "Hi." },
    ];
    const t = transcriptOf(jamieAdapter.parse(JSON.stringify(body), NO_HEADERS, CONTEXT));
    expect(t.occurredAt).toBe("2026-10-22T09:00:00.000Z");
    expect(t.durationSec).toBeNull();
    expect(t.segments).toEqual([{ speakerId: "2", speakerName: "Petr Ivanov", text: "Hi." }]);
  });

  it("refuses broken JSON, a body without a transcript and a transcript without text", () => {
    expect(jamieAdapter.parse("{", NO_HEADERS, CONTEXT)).toEqual({ outcome: "refused", error: "bad_json" });
    const { transcript: _, ...data } = meeting.data;
    const noTranscript = JSON.stringify({ ...meeting, data });
    expect(jamieAdapter.parse(noTranscript, NO_HEADERS, CONTEXT)).toEqual({
      outcome: "refused",
      error: "payload_invalid",
    });
    const empty = JSON.stringify({
      ...meeting,
      data: { ...meeting.data, transcript: [{ speakerId: "0", speakerName: "A", text: "" }] },
    });
    expect(jamieAdapter.parse(empty, NO_HEADERS, CONTEXT)).toEqual({
      outcome: "refused",
      error: "payload_invalid",
    });
  });

  it("knows its placeholder names", () => {
    expect(jamieAdapter.isPlaceholderName("Speaker 1")).toBe(true);
    expect(jamieAdapter.isPlaceholderName("speaker 12")).toBe(true);
    expect(jamieAdapter.isPlaceholderName("Speaker -1")).toBe(true);
    expect(jamieAdapter.isPlaceholderName("Speaker")).toBe(false);
    expect(jamieAdapter.isPlaceholderName("Speaker One")).toBe(false);
  });

  it("checks the signature: valid, wrong, missing, malformed and too old", async () => {
    const secret = { signingSecret: "whsec_test" };
    const verify = (headers: Headers) => jamieAdapter.verify?.(raw, headers, secret);
    const now = Math.floor(Date.now() / 1000);
    const valid = await jamieSignature(raw, secret.signingSecret, now);
    expect(await verify(new Headers({ "x-jamie-signature": valid }))).toBe(true);
    const wrong = await jamieSignature(raw, "another secret", now);
    expect(await verify(new Headers({ "x-jamie-signature": wrong }))).toBe(false);
    expect(await verify(NO_HEADERS)).toBe(false);
    expect(await verify(new Headers({ "x-jamie-signature": "t=abc,v0=00" }))).toBe(false);
    const old = await jamieSignature(raw, secret.signingSecret, now - 2 * 3600 - 5);
    expect(await verify(new Headers({ "x-jamie-signature": old }))).toBe(false);
    const recent = await jamieSignature(raw, secret.signingSecret, now - 2 * 3600 + 60);
    expect(await verify(new Headers({ "x-jamie-signature": recent }))).toBe(true);
  });
});

describe("the json adapter", () => {
  it("makes speaker ids from speaker names and keeps learnerSpeaker as the hint", () => {
    const t = transcriptOf(jsonAdapter.parse(JSON.stringify(jsonTranscript), NO_HEADERS, CONTEXT));
    expect(t).toMatchObject({
      externalId: jsonTranscript.id,
      kind: "chat",
      title: jsonTranscript.title,
      occurredAt: jsonTranscript.occurredAt,
      learnerSpeakerHint: "Petr Ivanov",
    });
    expect(t.participants.map((p) => p.id)).toEqual(["Laura Bennett", "Petr Ivanov"]);
    expect(t.segments[1]).toEqual({
      speakerId: "Petr Ivanov",
      speakerName: "Petr Ivanov",
      text: jsonTranscript.segments[1]?.text,
    });
  });

  it("uses the defaults and refuses a body that is not JsonSourceBody", () => {
    const body = JSON.stringify({ segments: [{ speaker: "A", text: "Hello" }] });
    const t = transcriptOf(jsonAdapter.parse(body, NO_HEADERS, CONTEXT));
    expect(t).toMatchObject({ externalId: null, kind: "call", title: null, occurredAt: CONTEXT.receivedAt });
    expect(jsonAdapter.parse('{"segments":[]}', NO_HEADERS, CONTEXT)).toEqual({
      outcome: "refused",
      error: "payload_invalid",
    });
    expect(jsonAdapter.parse("[", NO_HEADERS, CONTEXT)).toEqual({ outcome: "refused", error: "bad_json" });
  });
});

describe("the paste format", () => {
  it("reads named lines as turns and continues a turn with lines without a name", () => {
    const t = pasteTranscript({ text: pasteText }, CONTEXT);
    expect(t?.kind).toBe("call");
    expect(t?.segments.map((s) => s.speakerId)).toEqual([
      "Maria Lopez",
      "Petr",
      "Maria Lopez",
      "Petr",
      "Maria Lopez",
      "Petr",
      "Maria Lopez",
    ]);
    expect(t?.segments[3]?.text).toBe(
      "The revenue is very very good, it grew on twelve percent compared with last quarter.\n" +
        "And the costs stayed almost the same, only the servers became more expensive.",
    );
  });

  it("gives text without names to the user, as kind text", () => {
    const t = pasteTranscript({ text: "I have went there.\n\nAt 10:30 see https://example.com" }, CONTEXT);
    expect(t?.kind).toBe("text");
    expect(t?.segments).toEqual([
      {
        speakerId: "Petr",
        speakerName: "Petr",
        text: "I have went there.\nAt 10:30 see https://example.com",
      },
    ]);
  });

  it("gives lines before the first name to the user and drops turns without text", () => {
    const t = pasteTranscript({ text: "Notes from Monday\nAnna:\nBoris:  Hi  there\n" }, CONTEXT);
    expect(t?.segments).toEqual([
      { speakerId: "Petr", speakerName: "Petr", text: "Notes from Monday" },
      { speakerId: "Boris", speakerName: "Boris", text: "Hi  there" },
    ]);
    expect(pasteTranscript({ text: " \n Anna: \n" }, CONTEXT)).toBeNull();
  });
});

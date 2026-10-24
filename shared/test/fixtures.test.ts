// Every fixture parses with its schema, and the analysis fixture fits the Jamie meeting it was written for.
import { describe, expect, test } from "vitest";
import { z } from "zod";
import resultNative from "../fixtures/analysis/result-native-language.json";
import resultOk from "../fixtures/analysis/result-ok.json";
import claimResponse from "../fixtures/deliveries/claim-response.json";
import meeting from "../fixtures/jamie/meeting-completed.json";
import meetingGerman from "../fixtures/jamie/meeting-completed-german.json";
import meetingUnknown from "../fixtures/jamie/meeting-completed-unknown-speakers.json";
import jsonTranscript from "../fixtures/json/transcript.json";
import pasteText from "../fixtures/paste/transcript.txt?raw";
import alertPush from "../fixtures/push/deliveries-alert.json";
import backgroundPush from "../fixtures/push/deliveries-background.json";
import testPush from "../fixtures/push/test.json";
import {
  AlertPush,
  AnalysisResult,
  BackgroundPush,
  ClaimResponse,
  itemKey,
  JsonSourceBody,
  marker,
  normalizeTerm,
  PasteTranscriptBody,
  TestPush,
} from "../src";

// The fields of docs/backend/sources/jamie.md. The adapter itself is the worker's (B06).
const JamieMeetingCompleted = z.object({
  metadata: z.object({ id: z.string().min(1), event: z.literal("meeting.completed") }),
  data: z.object({
    title: z.string().min(1),
    startTime: z.iso.datetime(),
    endTime: z.iso.datetime().nullable(),
    user: z.object({ email: z.email() }),
    participants: z.array(
      z.object({ id: z.string().min(1), name: z.string().min(1), email: z.email().nullable() }),
    ),
    transcript: z.array(
      z.object({ speakerId: z.string().min(1), speakerName: z.string().min(1), text: z.string() }),
    ),
    summary: z.string(),
    tasks: z.array(z.unknown()),
    tags: z.array(z.string()),
  }),
});
type JamieMeetingCompleted = z.infer<typeof JamieMeetingCompleted>;

function recorderLines(body: JamieMeetingCompleted): string[] {
  const email = body.data.user.email.toLowerCase();
  const recorder = body.data.participants.filter((p) => p.email?.toLowerCase() === email);
  if (recorder.length !== 1) return [];
  return body.data.transcript.filter((s) => s.speakerId === recorder[0]?.id).map((s) => s.text);
}

describe("Jamie fixtures", () => {
  test("meeting-completed: 40 turns, 3 speakers, the recorder is Petr Ivanov", () => {
    const body = JamieMeetingCompleted.parse(meeting);
    expect(body.data.transcript).toHaveLength(40);
    expect(new Set(body.data.transcript.map((s) => s.speakerId)).size).toBe(3);
    const ids = new Set(body.data.participants.map((p) => p.id));
    expect(body.data.transcript.every((s) => ids.has(s.speakerId))).toBe(true);
    const recorder = body.data.participants.find(
      (p) => p.email?.toLowerCase() === body.data.user.email.toLowerCase(),
    );
    expect(recorder?.name).toBe("Petr Ivanov");
  });

  test("meeting-completed-unknown-speakers: placeholder names, no emails, the recorder matches nobody", () => {
    const body = JamieMeetingCompleted.parse(meetingUnknown);
    expect(body.data.participants.map((p) => p.name)).toEqual(["Speaker 1", "Speaker 2"]);
    expect(body.data.participants.every((p) => p.email === null)).toBe(true);
    expect(recorderLines(body)).toEqual([]);
  });

  test("meeting-completed-german: Petr is the recorder", () => {
    const body = JamieMeetingCompleted.parse(meetingGerman);
    expect(recorderLines(body).length).toBeGreaterThan(3);
  });
});

describe("analysis fixtures", () => {
  const result = AnalysisResult.parse(resultOk);
  const petrLines = recorderLines(JamieMeetingCompleted.parse(meeting));

  test("result-ok has the planned shape", () => {
    expect(result.status).toBe("ok");
    expect(result.language).toBe("en");
    expect(result.findings).toHaveLength(6);
    expect(result.findings.filter((f) => f.category === "register")).toHaveLength(2);
    expect(result.words).toHaveLength(4);
    expect(result.phrases).toHaveLength(2);
    expect(result.rewrites).toHaveLength(2);
  });

  test("quotes, originals and the learner's own versions are exact fragments of Petr's lines", () => {
    const fragments = [
      ...result.findings.flatMap((f) => f.examples.map((e) => e.quote)),
      ...result.rewrites.map((r) => r.original),
      ...result.words.flatMap((w) => (w.learnerSaid === null ? [] : [w.learnerSaid])),
      ...result.phrases.flatMap((p) => (p.insteadOf === null ? [] : [p.insteadOf])),
    ];
    expect(fragments.length).toBeGreaterThan(15);
    for (const fragment of fragments) {
      expect(
        petrLines.some((line) => line.includes(fragment)),
        fragment,
      ).toBe(true);
    }
  });

  test("match terms use all four modes and both languages", () => {
    const terms = [
      ...result.findings.flatMap((f) => f.matchTerms),
      ...result.words.flatMap((w) => w.matchTerms),
      ...result.phrases.flatMap((p) => p.matchTerms),
      ...result.rewrites.flatMap((r) => r.matchTerms),
    ];
    expect(new Set(terms.map((t) => t.mode))).toEqual(new Set(["word", "prefix", "phrase", "substring"]));
    expect(new Set(terms.map((t) => t.lang))).toEqual(new Set(["en", "ru"]));
  });

  test("result-native-language parses with empty lists", () => {
    const native = AnalysisResult.parse(resultNative);
    expect(native.status).toBe("native_language");
    expect([...native.findings, ...native.words, ...native.phrases, ...native.rewrites]).toEqual([]);
  });
});

describe("source fixtures", () => {
  test("json/transcript.json is a JsonSourceBody with learnerSpeaker", () => {
    const body = JsonSourceBody.parse(jsonTranscript);
    expect(body.learnerSpeaker).toBeDefined();
    expect(body.segments.some((s) => s.speaker === body.learnerSpeaker)).toBe(true);
  });

  test("paste/transcript.txt has Name: text lines and one line that continues a turn", () => {
    expect(PasteTranscriptBody.parse({ text: pasteText }).text).toBe(pasteText);
    const lines = pasteText.split("\n").filter((line) => line !== "");
    const continued = lines.filter((line) => !/^[^:]{1,80}: /.test(line));
    expect(continued).toHaveLength(1);
    expect(lines.length - continued.length).toBeGreaterThan(4);
  });
});

describe("delivery and push fixtures", () => {
  test("the claim response parses; item keys, markers and match terms are computed from the analysis", async () => {
    const claim = ClaimResponse.parse(claimResponse);
    const result = AnalysisResult.parse(resultOk);
    expect(claim.deliveries.map((d) => d.recommendation.kind)).toEqual(["mistake", "word"]);

    const [mistake, word] = claim.deliveries.map((d) => d.recommendation);
    const finding = result.findings.find((f) => f.patternKey === mistake?.itemKey);
    const suggestion = result.words.find((w) => w.term === "make a decision");
    if (!mistake || !word || !finding || !suggestion) throw new Error("fixture items are missing");

    expect(await itemKey("mistake", finding)).toBe(mistake.itemKey);
    expect(await itemKey("word", suggestion)).toBe(word.itemKey);
    expect(word.matchTerms).toEqual(suggestion.matchTerms.map(normalizeTerm));
    for (const rec of [mistake, word]) {
      expect(await marker(rec.language, rec.itemKey)).toBe(rec.marker);
    }
  });

  test("push payloads parse", () => {
    expect(AlertPush.parse(alertPush).mozol.pending).toBe(2);
    expect(BackgroundPush.parse(backgroundPush).mozol.pending).toBe(2);
    expect(TestPush.parse(testPush).mozol.type).toBe("test");
  });
});

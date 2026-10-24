import { introspectWorkflow } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  AnalysisResult,
  type Transcript,
  TranscriptDetailResponse,
  TranscriptResponse,
  TranscriptsPage,
} from "shared";
import resultOk from "shared/fixtures/analysis/result-ok.json";
import pasteText from "shared/fixtures/paste/transcript.txt?raw";
import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "../src/analysis/prompt";
import { call, expectError, signUp } from "./helpers";
import { storedTranscript } from "./hooks-helpers";

async function paste(cookie: string, body: Record<string, unknown>): Promise<Transcript> {
  const res = await call("/api/transcripts", { cookie, body });
  expect(res.status).toBe(201);
  return TranscriptResponse.parse(await res.json()).transcript;
}

const TWO_SPEAKERS = "Anna Berg: Hello, how was the trip?\nBoris: It was great, thank you.";

describe("POST /api/transcripts", () => {
  it("stores the paste fixture as a call and finds the user by a speaker name", async () => {
    const { cookie } = await signUp({ displayName: "Petr" });
    const transcript = await paste(cookie, { text: pasteText, title: "Quarterly review" });
    expect(transcript).toMatchObject({
      source: "paste",
      connectionId: null,
      kind: "call",
      title: "Quarterly review",
      status: "queued",
      learnerSpeakerName: "Petr",
      counts: null,
    });
    const row = await storedTranscript(transcript.id);
    expect(row).toMatchObject({ learner_speaker_id: "Petr", run: 1, external_id: null });
    expect(JSON.parse(row.segments)).toHaveLength(7);
    const events = await env.DB.prepare("SELECT count(*) AS n FROM hook_events WHERE transcript_id = ?")
      .bind(transcript.id)
      .first<{ n: number }>();
    expect(events?.n).toBe(0);
  });

  it("stores text without names as the user's own text", async () => {
    const { cookie } = await signUp({ displayName: "Petr S." });
    const occurredAt = "2026-10-20T08:00:00.000Z";
    const transcript = await paste(cookie, { text: "I have wrote this email yesterday.", occurredAt });
    expect(transcript).toMatchObject({
      kind: "text",
      status: "queued",
      learnerSpeakerName: "Petr S.",
      occurredAt,
    });
    expect((await storedTranscript(transcript.id)).learner_word_count).toBe(6);
  });

  it("refuses a body that does not match the schema and a text without any text", async () => {
    const { cookie } = await signUp();
    await expectError(
      await call("/api/transcripts", { cookie, body: { text: "" } }),
      400,
      "validation_failed",
    );
    await expectError(
      await call("/api/transcripts", { cookie, body: { text: " \n " } }),
      422,
      "payload_invalid",
    );
  });
});

describe("GET /api/transcripts", () => {
  it("pages by occurredAt, newest first", async () => {
    const { cookie } = await signUp();
    const times = ["2026-10-01T10:00:00.000Z", "2026-10-03T10:00:00.000Z", "2026-10-02T10:00:00.000Z"];
    for (const occurredAt of times) await paste(cookie, { text: "Hello there.", occurredAt });

    const first = TranscriptsPage.parse(await (await call("/api/transcripts?limit=2", { cookie })).json());
    expect(first.items.map((t) => t.occurredAt)).toEqual([times[1], times[2]]);
    expect(first.nextCursor).not.toBeNull();
    const next = `/api/transcripts?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`;
    const second = TranscriptsPage.parse(await (await call(next, { cookie })).json());
    expect(second.items.map((t) => t.occurredAt)).toEqual([times[0]]);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses a broken cursor and lists nothing of another user", async () => {
    const { cookie } = await signUp();
    await paste(cookie, { text: "Hello there." });
    const other = await signUp();
    const page = TranscriptsPage.parse(
      await (await call("/api/transcripts", { cookie: other.cookie })).json(),
    );
    expect(page).toEqual({ items: [], nextCursor: null });
    const res = await call("/api/transcripts?cursor=nonsense", { cookie });
    const body = await expectError(res, 400, "validation_failed");
    expect(body.issues).toEqual([{ path: "cursor", code: "invalid_format" }]);
  });
});

describe("GET /api/transcripts/:id", () => {
  it("shows the segments, and after the run the analysis, the language and the counts", async () => {
    const { cookie } = await signUp({ displayName: "Petr" });
    await using introspector = await introspectWorkflow(env.ANALYZE);
    const { id } = await paste(cookie, { text: pasteText });
    for (const instance of await introspector.get()) await instance.waitForStatus("complete");
    const res = await call(`/api/transcripts/${id}`, { cookie });
    expect(res.status).toBe(200);
    const { transcript } = TranscriptDetailResponse.parse(await res.json());
    expect(transcript).not.toHaveProperty("speakers");
    expect(transcript.segments).toHaveLength(7);
    expect(transcript.segments[0]).toEqual({
      speakerId: "Maria Lopez",
      speakerName: "Maria Lopez",
      text: "Good morning, Petr. Do you have the numbers for the quarterly review?",
    });
    expect(transcript).toMatchObject({
      status: "analyzed",
      language: "en",
      counts: { findings: 3, words: 3 },
      learnerSpeakerName: "Petr",
    });
    // Delivery order: high-severity mistakes, words, then the medium one; each has a pending delivery.
    expect(transcript.recommendations.map((r) => [r.itemKey, r.delivery?.status])).toEqual([
      ["grammar.articles.missing_or_wrong", "pending"],
      ["grammar.tenses.present_perfect_with_past_time", "pending"],
      ["word:make a decision", "pending"],
      ["word:crucial", "pending"],
      ["word:people with disabilities", "pending"],
      ["vocabulary.false_friend.actual", "pending"],
    ]);
    expect(transcript.analysis).toMatchObject({ model: "fixture", promptVersion: PROMPT_VERSION });
    expect(transcript.analysis?.result).toEqual(AnalysisResult.parse(resultOk));
  });

  it("answers 404 for a transcript of another user", async () => {
    const { cookie } = await signUp();
    const { id } = await paste(cookie, { text: "Hello there." });
    const other = await signUp();
    await expectError(await call(`/api/transcripts/${id}`, { cookie: other.cookie }), 404, "not_found");
  });
});

describe("a transcript where no rule finds the user", () => {
  it("starts the analysis with learner_speaker_id null", async () => {
    const { cookie } = await signUp({ displayName: "Petr" });
    const transcript = await paste(cookie, { text: TWO_SPEAKERS });
    expect(transcript).toMatchObject({ status: "queued", learnerSpeakerName: null });
    expect(await storedTranscript(transcript.id)).toMatchObject({
      status: "queued",
      learner_speaker_id: null,
      learner_word_count: null,
      run: 1,
    });
  });

  it("has no speaker endpoint", async () => {
    const { cookie } = await signUp({ displayName: "Petr" });
    const { id } = await paste(cookie, { text: TWO_SPEAKERS });
    const res = await call(`/api/transcripts/${id}/speaker`, { cookie, body: { speakerId: "Boris" } });
    expect(res.status).toBe(404);
  });
});

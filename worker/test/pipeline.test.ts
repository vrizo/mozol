import { introspectWorkflow } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  AnalysisResult,
  ErrorBody,
  PatternResponse,
  PatternsResponse,
  TranscriptDetailResponse,
  TranscriptResponse,
  WordResponse,
  WordsResponse,
} from "shared";
import resultNative from "shared/fixtures/analysis/result-native-language.json";
import resultOk from "shared/fixtures/analysis/result-ok.json";
import meeting from "shared/fixtures/jamie/meeting-completed.json";
import meetingUnknown from "shared/fixtures/jamie/meeting-completed-unknown-speakers.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisError } from "../src/analysis/errors";
import { ClaudeSpeakerPicker, SpeakerAnswerError, type SpeakerPicker } from "../src/analysis/speaker";
import { participantsColumn, segmentsColumn } from "../src/db/transcripts";
import { newId } from "../src/ids";
import { prepareRun } from "../src/pipeline/prepare";
import { chooseLearner } from "../src/pipeline/speaker";
import { startAnalysis } from "../src/pipeline/start";
import { clearResults, storeResult } from "../src/pipeline/store";
import { errorCode, stepError } from "../src/pipeline/workflow";
import { jamieAdapter } from "../src/sources/jamie";
import type { Segment } from "../src/sources/types";
import { call, expectError, signUp } from "./helpers";

type Result = AnalysisResult;
const OK = AnalysisResult.parse(resultOk);
const NATIVE = AnalysisResult.parse(resultNative);

function jamieSegments(body: unknown): Segment[] {
  const parsed = jamieAdapter.parse(JSON.stringify(body), new Headers(), {
    receivedAt: "2026-10-24T12:00:00.000Z",
    userName: "Petr",
  });
  if (parsed.outcome !== "transcript") throw new Error(`expected a transcript, got ${parsed.outcome}`);
  return parsed.transcript.segments;
}

const SEGMENTS = jamieSegments(meeting);
const PETR = SEGMENTS.find((s) => s.speakerName === "Petr Ivanov")?.speakerId ?? "";

type TranscriptOptions = {
  occurredAt?: string;
  source?: "jamie" | "paste" | "json";
  segments?: Segment[];
  learner?: string | null;
  learnerWords?: number | null;
  run?: number;
  status?: string;
};

// A transcript row written straight into D1, so no workflow starts.
async function transcript(userId: string, options: TranscriptOptions = {}): Promise<string> {
  const id = newId("trn");
  const now = new Date().toISOString();
  const learner = options.learner === undefined ? PETR : options.learner;
  await env.DB.prepare(
    `INSERT INTO transcripts (id, user_id, source, kind, occurred_at, participants, segments, learner_speaker_id,
       learner_word_count, status, run, created_at, updated_at)
     VALUES (?, ?, ?, 'call', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      options.source ?? "jamie",
      options.occurredAt ?? "2026-10-22T09:00:00.000Z",
      participantsColumn([]),
      segmentsColumn(options.segments ?? SEGMENTS),
      learner,
      options.learnerWords === undefined ? (learner === null ? null : 300) : options.learnerWords,
      options.status ?? "analyzing",
      options.run ?? 1,
      now,
      now,
    )
    .run();
  return id;
}

async function analysis(transcriptId: string, userId: string, run: number, result: Result): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO analyses (id, transcript_id, user_id, run, prompt_version, model, status, language, result,
       input_tokens, output_tokens, cache_read_tokens, duration_ms, unmatched_quotes, created_at)
     VALUES (?, ?, ?, ?, 'analysis-v2', 'fixture', ?, ?, ?, 0, 0, 0, 0, 0, ?)
     ON CONFLICT (transcript_id) DO UPDATE SET run = excluded.run, status = excluded.status,
       language = excluded.language, result = excluded.result`,
  )
    .bind(
      newId("ana"),
      transcriptId,
      userId,
      run,
      result.status,
      result.language,
      JSON.stringify(result),
      "2026-10-24T12:00:00.000Z",
    )
    .run();
}

async function setRun(transcriptId: string, run: number): Promise<void> {
  await env.DB.prepare("UPDATE transcripts SET run = ? WHERE id = ?").bind(run, transcriptId).run();
}

// Stores a result as the analysis of the transcript's run.
async function store(transcriptId: string, userId: string, result: Result, run = 1) {
  await setRun(transcriptId, run);
  await analysis(transcriptId, userId, run, result);
  return storeResult(env, transcriptId, run);
}

async function rows<T>(sql: string, ...binds: unknown[]): Promise<T[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<T>()
  ).results;
}

type PatternRow = {
  id: string;
  language: string;
  key: string;
  title: string;
  occurrences_total: number;
  transcripts_count: number;
  sources: string;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
};

const patternsOf = (userId: string) =>
  rows<PatternRow>(
    `SELECT id, language, key, title, occurrences_total, transcripts_count, sources, first_seen_at, last_seen_at,
       status FROM patterns WHERE user_id = ? ORDER BY language, key`,
    userId,
  );

type WordRow = {
  language: string;
  word_key: string;
  times_suggested: number;
  last_seen_at: string;
  status: string;
};

const wordsOf = (userId: string) =>
  rows<WordRow>(
    "SELECT language, word_key, times_suggested, last_seen_at, status FROM words WHERE user_id = ? ORDER BY language, word_key",
    userId,
  );

// The rows a store writes, without ids and times of writing.
async function snapshot(userId: string) {
  return {
    findings: await rows(
      `SELECT f.transcript_id, p.key, f.language, f.category, f.severity, f.occurrences, f.title, f.examples,
         f.explanation, f.tip, f.match_terms FROM findings f JOIN patterns p ON p.id = f.pattern_id
       WHERE f.user_id = ? ORDER BY f.transcript_id, p.key`,
      userId,
    ),
    suggestions: await rows(
      `SELECT s.transcript_id, w.word_key, s.reason, s.learner_said, s.example, s.match_terms
       FROM word_suggestions s JOIN words w ON w.id = s.word_id WHERE s.user_id = ? ORDER BY s.transcript_id, w.word_key`,
      userId,
    ),
    keywords: await rows(
      "SELECT transcript_id, item_key, language, term, term_lang, mode FROM keywords WHERE user_id = ? ORDER BY 1, 2, 4, 5, 6",
      userId,
    ),
    patterns: await patternsOf(userId),
    words: await wordsOf(userId),
  };
}

// The number of distinct normalized match terms per item of a result.
const KEYWORDS_OK = 25;

function german(): Result {
  return AnalysisResult.parse({
    status: "ok",
    language: "de",
    findings: [
      {
        ...OK.findings[0],
        examples: [{ quote: "der Problem", correction: "das Problem" }],
        matchTerms: [{ text: "checkout", lang: "de", mode: "word" }],
      },
    ],
    words: [
      { ...OK.words[0], term: "der Termin", matchTerms: [{ text: "termin", lang: "de", mode: "word" }] },
    ],
  });
}

describe("storeResult", () => {
  it("writes findings, word suggestions, keywords, patterns and words; a second call changes nothing", async () => {
    const { user } = await signUp();
    const id = await transcript(user.id);
    const first = await store(id, user.id, OK);
    expect(first.outcome).toBe("analyzed");
    // The largest batch with the fixture result: reported in the step report.
    expect(first.statements).toBe(24);

    const after = await snapshot(user.id);
    expect(after.findings).toHaveLength(3);
    expect(after.suggestions).toHaveLength(3);
    expect(after.keywords).toHaveLength(KEYWORDS_OK);
    expect(
      after.patterns.map((p) => [p.key, p.occurrences_total, p.transcripts_count, p.sources, p.status]),
    ).toEqual([
      ["grammar.articles.missing_or_wrong", 4, 1, '["jamie"]', "active"],
      ["grammar.tenses.present_perfect_with_past_time", 2, 1, '["jamie"]', "active"],
      ["vocabulary.false_friend.actual", 2, 1, '["jamie"]', "active"],
    ]);
    expect(after.words.map((w) => [w.word_key, w.times_suggested, w.status])).toEqual([
      ["crucial", 1, "new"],
      ["make a decision", 1, "new"],
      ["people with disabilities", 1, "new"],
    ]);
    const keys = new Set(after.keywords.map((k) => (k as { item_key: string }).item_key));
    expect(keys).toEqual(
      new Set([...OK.findings.map((f) => f.patternKey), ...OK.words.map((w) => `word:${w.term}`)]),
    );
    expect(after.keywords).toContainEqual({
      transcript_id: id,
      item_key: "grammar.articles.missing_or_wrong",
      language: "en",
      term: "research results",
      term_lang: "en",
      mode: "phrase",
    });
    const [row] = await rows<{ status: string; language: string; analyzed_at: string | null }>(
      "SELECT status, language, analyzed_at FROM transcripts WHERE id = ?",
      id,
    );
    expect(row).toMatchObject({ status: "analyzed", language: "en" });
    expect(row?.analyzed_at).not.toBeNull();

    const second = await storeResult(env, id, 1);
    expect(second.statements).toBe(28);
    expect(await snapshot(user.id)).toEqual(after);
  });

  it("makes patterns recurring when a second transcript has the same result", async () => {
    const { user } = await signUp();
    await store(await transcript(user.id, { occurredAt: "2026-10-20T09:00:00.000Z" }), user.id, OK);
    await store(
      await transcript(user.id, { occurredAt: "2026-10-22T09:00:00.000Z", source: "paste" }),
      user.id,
      OK,
    );
    const patterns = await patternsOf(user.id);
    expect(patterns.map((p) => [p.occurrences_total, p.transcripts_count])).toEqual([
      [8, 2],
      [4, 2],
      [4, 2],
    ]);
    expect(patterns[0]).toMatchObject({
      sources: '["jamie","paste"]',
      first_seen_at: "2026-10-20T09:00:00.000Z",
      last_seen_at: "2026-10-22T09:00:00.000Z",
    });
    expect((await wordsOf(user.id)).map((w) => w.times_suggested)).toEqual([2, 2, 2]);
  });

  it("on a re-run replaces the old findings, fixes the counts and deletes patterns without findings", async () => {
    const { user } = await signUp();
    const a = await transcript(user.id);
    const b = await transcript(user.id);
    await store(a, user.id, OK);
    await store(b, user.id, OK);
    const smaller = AnalysisResult.parse({ ...OK, findings: OK.findings.slice(0, 1), words: [] });
    await store(b, user.id, smaller, 2);

    const patterns = await patternsOf(user.id);
    expect(patterns.map((p) => [p.key, p.occurrences_total, p.transcripts_count])).toEqual([
      ["grammar.articles.missing_or_wrong", 8, 2],
      ["grammar.tenses.present_perfect_with_past_time", 2, 1],
      ["vocabulary.false_friend.actual", 2, 1],
    ]);
    expect((await wordsOf(user.id)).map((w) => w.times_suggested)).toEqual([1, 1, 1]);

    await store(a, user.id, smaller, 2);
    expect((await patternsOf(user.id)).map((p) => p.key)).toEqual(["grammar.articles.missing_or_wrong"]);
    expect(await wordsOf(user.id)).toEqual([]);
    expect(
      await rows("SELECT 1 FROM keywords WHERE user_id = ? AND item_key LIKE 'word:%'", user.id),
    ).toEqual([]);
  });

  it("clears the findings and fixes the counts when a re-run ends native_language", async () => {
    const { user } = await signUp();
    const id = await transcript(user.id);
    await store(id, user.id, OK);
    const res = await store(id, user.id, NATIVE, 2);
    expect(res.outcome).toBe("skipped");
    expect(await snapshot(user.id)).toEqual({
      findings: [],
      suggestions: [],
      keywords: [],
      patterns: [],
      words: [],
    });
    const [row] = await rows("SELECT status, skip_reason FROM transcripts WHERE id = ?", id);
    expect(row).toEqual({ status: "skipped", skip_reason: "native_language" });
  });

  it("keeps patterns and words of another language apart", async () => {
    const { user } = await signUp();
    await store(await transcript(user.id), user.id, OK);
    await store(await transcript(user.id), user.id, german());
    const patterns = await patternsOf(user.id);
    expect(
      patterns.filter((p) => p.key === "grammar.articles.missing_or_wrong").map((p) => p.language),
    ).toEqual(["de", "en"]);
    expect(patterns.every((p) => p.transcripts_count === 1)).toBe(true);
    expect((await wordsOf(user.id)).filter((w) => w.language === "de").map((w) => w.word_key)).toEqual([
      "der termin",
    ]);
  });

  it("makes a learned pattern active when a new transcript has it, and leaves a dismissed one", async () => {
    const { user } = await signUp();
    const a = await transcript(user.id);
    await store(a, user.id, OK);
    await env.DB.prepare("UPDATE patterns SET status = 'learned' WHERE user_id = ? AND key LIKE 'grammar.%'")
      .bind(user.id)
      .run();
    await env.DB.prepare(
      "UPDATE patterns SET status = 'dismissed' WHERE user_id = ? AND key LIKE 'vocabulary.%'",
    )
      .bind(user.id)
      .run();
    // Storing the same transcript again is not a new appearance.
    await storeResult(env, a, 1);
    expect((await patternsOf(user.id)).map((p) => p.status)).toEqual(["learned", "learned", "dismissed"]);
    await store(await transcript(user.id), user.id, OK);
    expect((await patternsOf(user.id)).map((p) => p.status)).toEqual(["active", "active", "dismissed"]);
  });

  it("ends stale when the transcript's run changed", async () => {
    const { user } = await signUp();
    const id = await transcript(user.id);
    await analysis(id, user.id, 1, OK);
    await setRun(id, 2);
    expect(await storeResult(env, id, 1)).toEqual({ outcome: "stale", statements: 0 });
    expect(await rows("SELECT 1 FROM findings WHERE transcript_id = ?", id)).toEqual([]);
  });

  it("clearResults removes the rows and the patterns and words they alone held", async () => {
    const { user } = await signUp();
    const a = await transcript(user.id);
    const b = await transcript(user.id);
    await store(a, user.id, OK);
    await store(b, user.id, german());
    await clearResults(env, a);
    const after = await snapshot(user.id);
    expect(after.findings.every((f) => (f as { transcript_id: string }).transcript_id === b)).toBe(true);
    expect(after.patterns.map((p) => p.language)).toEqual(["de"]);
    expect(after.words.map((w) => w.language)).toEqual(["de"]);
  });
});

function picker(pick: SpeakerPicker["pick"]): SpeakerPicker {
  return { name: "fake", pick };
}

const unknownSegments = jamieSegments(meetingUnknown);

describe("chooseLearner", () => {
  const base = { rid: "abcdefabcdef", final: false };

  it("keeps a learner that is already set", async () => {
    const { user } = await signUp();
    const id = await transcript(user.id);
    const pick = vi.fn();
    expect(await chooseLearner(env, id, 1, { ...base, picker: picker(pick) })).toBe("kept");
    expect(pick).not.toHaveBeenCalled();
  });

  it("stores the model's valid answer with the learner's word count", async () => {
    const { user } = await signUp({ displayName: "Petr" });
    const id = await transcript(user.id, { learner: null });
    const pick = vi.fn<SpeakerPicker["pick"]>(async () => PETR);
    expect(await chooseLearner(env, id, 1, { ...base, picker: picker(pick) })).toBe("model");
    const question = pick.mock.calls[0]?.[0];
    if (question === undefined) throw new Error("the picker was not asked");
    expect(question.speakers.map((s) => s.id)).toEqual(["0", "1", "2"]);
    expect(question.speakers.every((s) => s.firstLines.length <= 5)).toBe(true);
    const [row] = await rows<{ learner_speaker_id: string; learner_word_count: number }>(
      "SELECT learner_speaker_id, learner_word_count FROM transcripts WHERE id = ?",
      id,
    );
    expect(row?.learner_speaker_id).toBe(PETR);
    expect(row?.learner_word_count).toBeGreaterThan(200);
  });

  it("picks at random after an invalid answer, a failed call on the last attempt, or in fixture mode", async () => {
    const { user } = await signUp();
    const cases: [SpeakerPicker | null, number, string][] = [
      [picker(async () => Promise.reject(new SpeakerAnswerError("invalid"))), 0, "0"],
      [picker(async () => Promise.reject(new Error("boom"))), 0.99, "2"],
      [null, 0.5, "1"],
    ];
    for (const [p, random, expected] of cases) {
      const id = await transcript(user.id, { learner: null });
      expect(await chooseLearner(env, id, 1, { ...base, picker: p, random: () => random })).toBe("random");
      const [row] = await rows<{ learner_speaker_id: string }>(
        "SELECT learner_speaker_id FROM transcripts WHERE id = ?",
        id,
      );
      expect(row?.learner_speaker_id).toBe(expected);
    }

    const failing = picker(async () => Promise.reject(new AnalysisError("analysis_failed", true, "429")));
    const id = await transcript(user.id, { learner: null });
    await expect(chooseLearner(env, id, 1, { ...base, picker: failing })).rejects.toBeInstanceOf(
      AnalysisError,
    );
    expect(await chooseLearner(env, id, 1, { ...base, final: true, picker: failing, random: () => 0 })).toBe(
      "random",
    );
  });

  it("refuses a model answer that is not a speaker id of the transcript", async () => {
    const answer = (text: string): BetaMessage =>
      ({
        content: [{ type: "text", text, citations: null }],
        stop_reason: "end_turn",
      }) as unknown as BetaMessage;
    const client = (message: BetaMessage) => ({
      beta: { messages: { stream: () => ({ finalMessage: async () => message }) } },
    });
    const question = {
      user: { displayName: "Petr", speakerNames: [], email: "p@example.com", nativeLanguage: "ru" },
      speakers: [{ id: "1", name: "Speaker 1", wordCount: 10, firstLines: ["Hi"] }],
    };
    const good = new ClaudeSpeakerPicker({
      client: client(answer('{"speakerId":"1"}')),
      model: "claude-opus-5-5",
    });
    expect(await good.pick(question)).toBe("1");
    const request = good.request(question);
    expect(request.output_config).toMatchObject({
      effort: "low",
      format: { schema: { properties: { speakerId: { enum: ["1"] } } } },
    });
    for (const text of ['{"speakerId":"7"}', "not json", '{"speaker":"1"}']) {
      const bad = new ClaudeSpeakerPicker({ client: client(answer(text)), model: "claude-opus-5-5" });
      await expect(bad.pick(question)).rejects.toBeInstanceOf(SpeakerAnswerError);
    }
    const rateLimited = {
      beta: {
        messages: {
          stream: () => {
            throw new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers());
          },
        },
      },
    };
    const limited = new ClaudeSpeakerPicker({ client: rateLimited, model: "claude-opus-5-5" });
    await expect(limited.pick(question)).rejects.toMatchObject({ code: "analysis_failed", retryable: true });
  });

  it("always ends with a learner for the unknown-speakers Jamie fixture", async () => {
    const { user } = await signUp();
    for (const random of [0, 0.5, 0.999]) {
      const id = await transcript(user.id, { segments: unknownSegments, learner: null });
      await chooseLearner(env, id, 1, { ...base, random: () => random });
      const [row] = await rows<{ learner_speaker_id: string | null; learner_word_count: number | null }>(
        "SELECT learner_speaker_id, learner_word_count FROM transcripts WHERE id = ?",
        id,
      );
      expect(unknownSegments.some((s) => s.speakerId === row?.learner_speaker_id)).toBe(true);
      expect(row?.learner_word_count).toBeGreaterThan(0);
    }
  });

  it("ends stale when the run changed", async () => {
    const { user } = await signUp();
    const id = await transcript(user.id, { learner: null, run: 2 });
    expect(await chooseLearner(env, id, 1, base)).toBe("stale");
  });
});

describe("prepareRun", () => {
  it("skips below 30 learner words and clears earlier results", async () => {
    const { user } = await signUp();
    const id = await transcript(user.id);
    await store(id, user.id, OK);
    await env.DB.prepare("UPDATE transcripts SET run = 2, learner_word_count = 29 WHERE id = ?")
      .bind(id)
      .run();
    expect(await prepareRun(env, id, 2)).toBe("skipped");
    expect(await snapshot(user.id)).toEqual({
      findings: [],
      suggestions: [],
      keywords: [],
      patterns: [],
      words: [],
    });
    const [row] = await rows("SELECT status, skip_reason FROM transcripts WHERE id = ?", id);
    expect(row).toEqual({ status: "skipped", skip_reason: "too_short" });
  });

  it("marks a long enough transcript analyzing, and ends stale on another run", async () => {
    const { user } = await signUp();
    const id = await transcript(user.id, { status: "queued", learnerWords: 30 });
    expect(await prepareRun(env, id, 2)).toBe("stale");
    expect(await prepareRun(env, id, 1)).toBe("ready");
    const [row] = await rows("SELECT status FROM transcripts WHERE id = ?", id);
    expect(row).toEqual({ status: "analyzing" });
  });
});

describe("the AnalyzeTranscript workflow", () => {
  afterEach(() => vi.restoreAllMocks());

  async function queued(options: TranscriptOptions = {}) {
    const { user, cookie } = await signUp();
    const id = await transcript(user.id, { status: "received", run: 0, ...options });
    return { user, cookie, id };
  }

  const statusOf = async (id: string) =>
    (
      await rows<{ status: string; skip_reason: string | null; error_code: string | null }>(
        "SELECT status, skip_reason, error_code FROM transcripts WHERE id = ?",
        id,
      )
    )[0];

  it("analyzes a queued transcript in fixture mode, choosing the learner first", async () => {
    const { id } = await queued({ learner: null });
    await using introspector = await introspectWorkflow(env.ANALYZE);
    expect(await startAnalysis(env, id, "abcdefabcdef")).toEqual({ run: 1, started: true });
    const [instance] = await introspector.get();
    await instance?.waitForStatus("complete");
    expect(await statusOf(id)).toEqual({ status: "analyzed", skip_reason: null, error_code: null });
    expect(await rows("SELECT 1 FROM findings WHERE transcript_id = ?", id)).toHaveLength(3);
  });

  it("fails with analysis_failed when retryable errors outlast the retries", async () => {
    const { id } = await queued();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await using introspector = await introspectWorkflow(env.ANALYZE);
    await introspector.modifyAll(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "analyze" }, new Error("analysis_failed: RateLimitError 429"));
    });
    await startAnalysis(env, id, "abcdefabcdef");
    const [instance] = await introspector.get();
    await instance?.waitForStatus("errored");
    expect(await statusOf(id)).toEqual({
      status: "failed",
      skip_reason: null,
      error_code: "analysis_failed",
    });
  });

  // A mocked step error loses its class, so a real non-retryable analysis error comes from the input: learner
  // lines over 400,000 characters.
  it("fails a non-retryable analysis error at once, without retries", async () => {
    const line = "word ".repeat(1000);
    const segments = Array.from({ length: 100 }, (_, i) => ({
      speakerId: PETR,
      speakerName: "Petr Ivanov",
      text: `${i} ${line}`,
    }));
    const { id } = await queued({ segments });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await using introspector = await introspectWorkflow(env.ANALYZE);
    // Retry delays stay on: a retry would wait 30 seconds and outlast the test timeout.
    await startAnalysis(env, id, "abcdefabcdef");
    const [instance] = await introspector.get();
    await instance?.waitForStatus("errored");
    expect(await statusOf(id)).toEqual({
      status: "failed",
      skip_reason: null,
      error_code: "transcript_too_long",
    });
  });

  it("skips the transcript with the reason of a native_language result", async () => {
    const { user, id } = await queued();
    await analysis(id, user.id, 1, NATIVE);
    await using introspector = await introspectWorkflow(env.ANALYZE);
    await introspector.modifyAll(async (m) => {
      await m.mockStepResult(
        { name: "analyze" },
        { outcome: "analyzed", analysisId: "ana_x", status: "native_language" },
      );
    });
    await startAnalysis(env, id, "abcdefabcdef");
    const [instance] = await introspector.get();
    await instance?.waitForStatus("complete");
    expect(await statusOf(id)).toEqual({
      status: "skipped",
      skip_reason: "native_language",
      error_code: null,
    });
  });

  it("turns non-retryable analysis errors into NonRetryableError and reads codes from messages", () => {
    const refused = stepError(new AnalysisError("analysis_refused", false, "category cyber"));
    expect(refused).toBeInstanceOf(NonRetryableError);
    expect((refused as Error).message).toBe("analysis_refused: category cyber");
    const limited = new AnalysisError("analysis_failed", true, "429");
    expect(stepError(limited)).toBe(limited);
    expect(errorCode(refused)).toBe("analysis_refused");
    expect(errorCode(new Error("transcript_too_long: 500000 characters"))).toBe("transcript_too_long");
    expect(errorCode(new Error("D1_ERROR: no such table"))).toBe("internal");
    expect(errorCode(new Error("unknown_code: x"))).toBe("internal");
    expect(errorCode(new Error("NonRetryableError: analysis_invalid: findings:too_big"))).toBe(
      "analysis_invalid",
    );
  });
});

describe("POST /api/transcripts/:id/analyze and DELETE /api/transcripts/:id", () => {
  it("answers 409 while the transcript is busy and starts a new run after 30 minutes", async () => {
    const { user, cookie } = await signUp();
    const id = await transcript(user.id, { status: "queued" });
    await expectError(
      await call(`/api/transcripts/${id}/analyze`, { method: "POST", cookie }),
      409,
      "transcript_busy",
    );

    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await env.DB.prepare("UPDATE transcripts SET updated_at = ? WHERE id = ?").bind(old, id).run();
    await using introspector = await introspectWorkflow(env.ANALYZE);
    const res = await call(`/api/transcripts/${id}/analyze`, { method: "POST", cookie });
    expect(res.status).toBe(202);
    const { transcript: started } = TranscriptResponse.parse(await res.json());
    expect(started).toMatchObject({ id, status: "queued" });
    const [instance] = await introspector.get();
    await instance?.waitForStatus("complete");
    const [row] = await rows<{ run: number; status: string }>(
      "SELECT run, status FROM transcripts WHERE id = ?",
      id,
    );
    expect(row).toEqual({ run: 2, status: "analyzed" });

    const detail = TranscriptDetailResponse.parse(
      await (await call(`/api/transcripts/${id}`, { cookie })).json(),
    );
    expect(detail.transcript.counts).toEqual({ findings: 3, words: 3 });

    await expectError(
      await call(`/api/transcripts/${id}/analyze`, { method: "POST", cookie: (await signUp()).cookie }),
      404,
      "not_found",
    );
  });

  it("deletes a transcript and fixes the counts", async () => {
    const { user, cookie } = await signUp();
    const a = await transcript(user.id);
    const b = await transcript(user.id);
    await store(a, user.id, OK);
    await store(b, user.id, OK);
    const res = await call(`/api/transcripts/${a}`, { method: "DELETE", cookie });
    expect(res.status).toBe(204);
    expect(await rows("SELECT 1 FROM transcripts WHERE id = ?", a)).toEqual([]);
    expect(await rows("SELECT 1 FROM analyses WHERE transcript_id = ?", a)).toEqual([]);
    expect((await patternsOf(user.id)).map((p) => p.transcripts_count)).toEqual([1, 1, 1]);
    expect((await wordsOf(user.id)).map((w) => w.times_suggested)).toEqual([1, 1, 1]);
    await expectError(await call(`/api/transcripts/${a}`, { method: "DELETE", cookie }), 404, "not_found");
  });
});

describe("patterns and words endpoints", () => {
  async function knowledge() {
    const { user, cookie } = await signUp();
    await store(await transcript(user.id, { occurredAt: "2026-10-20T09:00:00.000Z" }), user.id, OK);
    const smaller = AnalysisResult.parse({
      ...OK,
      findings: OK.findings.slice(2),
      words: OK.words.slice(1, 2),
    });
    await store(await transcript(user.id, { occurredAt: "2026-10-23T09:00:00.000Z" }), user.id, smaller);
    await store(await transcript(user.id, { occurredAt: "2026-10-21T09:00:00.000Z" }), user.id, german());
    return { user, cookie };
  }

  it("lists patterns recurring first, filters by status and language, and changes the status", async () => {
    const { cookie } = await knowledge();
    const list = PatternsResponse.parse(await (await call("/api/patterns?status=active", { cookie })).json());
    expect(list.patterns.map((p) => [p.language, p.key, p.recurring])).toEqual([
      ["en", "vocabulary.false_friend.actual", true],
      ["de", "grammar.articles.missing_or_wrong", false],
      ["en", "grammar.articles.missing_or_wrong", false],
      ["en", "grammar.tenses.present_perfect_with_past_time", false],
    ]);
    const actual = list.patterns[0];
    expect(actual).toMatchObject({ occurrencesTotal: 4, transcriptsCount: 2, sources: ["jamie"] });
    expect(actual?.latest).toEqual({
      examples: OK.findings[2]?.examples,
      explanation: OK.findings[2]?.explanation,
      tip: null,
    });

    const de = PatternsResponse.parse(
      await (await call("/api/patterns?status=active&language=de", { cookie })).json(),
    );
    expect(de.patterns.map((p) => p.language)).toEqual(["de"]);

    const patched = await call(`/api/patterns/${actual?.id}`, {
      method: "PATCH",
      cookie,
      body: { status: "learned" },
    });
    expect(patched.status).toBe(200);
    expect(PatternResponse.parse(await patched.json()).pattern).toMatchObject({
      id: actual?.id,
      status: "learned",
    });
    const learned = PatternsResponse.parse(
      await (await call("/api/patterns?status=learned", { cookie })).json(),
    );
    expect(learned.patterns.map((p) => p.id)).toEqual([actual?.id]);

    await expectError(await call("/api/patterns", { cookie }), 400, "validation_failed");
    const other = await signUp();
    await expectError(
      await call(`/api/patterns/${actual?.id}`, {
        method: "PATCH",
        cookie: other.cookie,
        body: { status: "active" },
      }),
      404,
      "not_found",
    );
  });

  it("lists words newest first, filters, and changes the status", async () => {
    const { cookie } = await knowledge();
    const list = WordsResponse.parse(await (await call("/api/words?status=new", { cookie })).json());
    expect(list.words.map((w) => [w.language, w.term, w.timesSuggested])).toEqual([
      ["en", "crucial", 2],
      ["de", "der Termin", 1],
      ["en", "make a decision", 1],
      ["en", "people with disabilities", 1],
    ]);
    const crucial = list.words[0];
    const patched = await call(`/api/words/${crucial?.id}`, {
      method: "PATCH",
      cookie,
      body: { status: "known" },
    });
    expect(WordResponse.parse(await patched.json()).word).toMatchObject({ status: "known" });
    const known = WordsResponse.parse(
      await (await call("/api/words?status=known&language=en", { cookie })).json(),
    );
    expect(known.words.map((w) => w.term)).toEqual(["crucial"]);
    const bad = await call(`/api/words/${crucial?.id}`, {
      method: "PATCH",
      cookie,
      body: { status: "great" },
    });
    expect(ErrorBody.parse(await bad.json()).error).toBe("validation_failed");
  });
});

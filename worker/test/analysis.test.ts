import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageStreamParams,
  BetaStopReason,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AnalysisResult } from "shared";
import resultOk from "shared/fixtures/analysis/result-ok.json";
import meeting from "shared/fixtures/jamie/meeting-completed.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisError, fromSdkError } from "../src/analysis/errors";
import {
  buildModelInput,
  type KnownPattern,
  MAX_TRANSCRIPT_CHARS,
  type ModelInput,
  type ModelInputParams,
} from "../src/analysis/input";
import {
  ClaudeModel,
  countUnmatchedQuotes,
  createModel,
  FixtureModel,
  interpretFinalMessage,
  runAnalysis,
  type StreamClient,
} from "../src/analysis/model";
import { PROMPT_VERSION, systemPrompt } from "../src/analysis/prompt";
import { jamieAdapter } from "../src/sources/jamie";
import { countWords, findLearner } from "../src/sources/learner";
import type { NormalizedTranscript, Segment } from "../src/sources/types";

const RU = { nativeLanguage: "ru" };

function jamieTranscript(): NormalizedTranscript {
  const parsed = jamieAdapter.parse(JSON.stringify(meeting), new Headers(), {
    receivedAt: "2026-10-24T12:00:00.000Z",
    userName: "Petr",
  });
  if (parsed.outcome !== "transcript") throw new Error(`expected a transcript, got ${parsed.outcome}`);
  return parsed.transcript;
}

function pattern(overrides: Partial<KnownPattern>): KnownPattern {
  return {
    language: "en",
    key: "grammar.articles.missing_the",
    title: "Пропущенный артикль the",
    matchTerms: [],
    status: "active",
    lastSeenAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

function params(segments: Segment[], overrides: Partial<ModelInputParams> = {}): ModelInputParams {
  return {
    transcript: { kind: "call", segments, learnerSpeakerId: "petr" },
    user: RU,
    knownPatterns: [],
    ...overrides,
  };
}

const anna = (text: string): Segment => ({ speakerId: "anna", speakerName: "Anna Smith", text });
const petr = (text: string): Segment => ({ speakerId: "petr", speakerName: "Petr Ivanov", text });

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected an error");
}

describe("buildModelInput", () => {
  it("writes the user message in the documented order, with only the learner's lines", () => {
    const input = buildModelInput(
      params([anna("Good morning, everyone."), petr("Good morning. I am agree with Anna."), anna("Great.")], {
        knownPatterns: [
          pattern({
            key: "vocabulary.false_friend.actual",
            title: "«actual» вместо «current»",
            matchTerms: [
              { text: "actual", lang: "en", mode: "word" },
              { text: "current", lang: "en", mode: "word" },
              { text: "актуальн", lang: "ru", mode: "prefix" },
            ],
          }),
        ],
      }),
    );
    expect(input.userMessage).toBe(
      [
        "Learner",
        "- Native language: Russian (ru)",
        "",
        "Source kind: call",
        "",
        "Known patterns (language | key | title | match terms)",
        "en | vocabulary.false_friend.actual | «actual» вместо «current» | actual, current, актуальн",
        "",
        "The learner's lines",
        "[1] Good morning. I am agree with Anna.",
      ].join("\n"),
    );
    expect(input.kind).toBe("call");
    expect(input.learnerWordCount).toBe(7);
    expect(input.learnerLines).toEqual(["Good morning. I am agree with Anna."]);
  });

  it("sends the learner's lines of the Jamie fixture and nothing of the other speakers", () => {
    const transcript = jamieTranscript();
    const learner = findLearner(
      transcript,
      { email: "petr.ivanov@example.com", speakerNames: [] },
      jamieAdapter,
    );
    if (learner === null) throw new Error("no learner in the Jamie fixture");
    const input = buildModelInput({
      transcript: {
        kind: transcript.kind,
        segments: transcript.segments,
        learnerSpeakerId: learner.speakerId,
      },
      user: RU,
      knownPatterns: [],
    });

    const petrSegments = meeting.data.transcript.filter((s) => s.speakerName === "Petr Ivanov");
    const others = meeting.data.transcript.filter((s) => s.speakerName !== "Petr Ivanov");
    expect(petrSegments).toHaveLength(14);
    const lines = input.userMessage.split("\n");
    const body = lines.slice(lines.indexOf("The learner's lines") + 1);
    expect(body).toEqual(petrSegments.map((s, i) => `[${i + 1}] ${s.text}`));
    expect(input.learnerLines).toEqual(petrSegments.map((s) => s.text));
    expect(input.learnerWordCount).toBe(petrSegments.reduce((sum, s) => sum + countWords(s.text), 0));
    for (const name of ["Laura Bennett", "Daniel Reed", "Petr Ivanov"]) {
      expect(input.userMessage).not.toContain(name);
    }
    for (const segment of others) expect(input.userMessage).not.toContain(segment.text);
    expect(lines.slice(lines.indexOf("Known patterns (language | key | title | match terms)") + 1)[0]).toBe(
      "none",
    );
  });

  it("lists up to 50 active patterns in any language, the most recently seen first", () => {
    const patterns = [
      pattern({
        language: "de",
        key: "grammar.cases.dative_after_mit",
        title: "Dativ nach mit",
        matchTerms: [],
      }),
      pattern({
        key: "grammar.articles.missing_the",
        lastSeenAt: "2026-10-22T10:00:00.000Z",
        matchTerms: [{ text: "deadline", lang: "en", mode: "word" }],
      }),
      pattern({ key: "register.swearing.shit", status: "dismissed", lastSeenAt: "2026-10-23T10:00:00.000Z" }),
      pattern({
        key: "grammar.tenses.learned_one",
        status: "learned",
        lastSeenAt: "2026-10-23T10:00:00.000Z",
      }),
    ];
    const lines = buildModelInput(
      params([petr("Hello there.")], { knownPatterns: patterns }),
    ).userMessage.split("\n");
    const start = lines.indexOf("Known patterns (language | key | title | match terms)") + 1;
    expect(lines.slice(start, lines.indexOf("The learner's lines") - 1)).toEqual([
      "en | grammar.articles.missing_the | Пропущенный артикль the | deadline",
      "de | grammar.cases.dative_after_mit | Dativ nach mit | (none)",
    ]);

    const many = Array.from({ length: 60 }, (_, i) =>
      pattern({
        key: `grammar.topic.detail_${i}`,
        lastSeenAt: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
      }),
    );
    const message = buildModelInput(params([petr("Hello there.")], { knownPatterns: many })).userMessage;
    expect(message.split("\n").filter((line) => line.startsWith("en | grammar.topic."))).toHaveLength(50);
  });

  it("sends a long transcript whole when the learner's lines fit", () => {
    const long = "word ".repeat(200);
    const segments = Array.from({ length: 600 }, (_, i) => (i % 3 === 2 ? petr("I am agree.") : anna(long)));
    expect(segments.map((s) => s.text).join("\n").length).toBeGreaterThan(MAX_TRANSCRIPT_CHARS);
    const input = buildModelInput(params(segments));
    expect(input.learnerLines).toHaveLength(200);
    expect(input.userMessage).not.toContain(long);
  });

  it("fails with transcript_too_long when the learner's lines are too long", () => {
    const segments = Array.from({ length: 900 }, (_, i) =>
      i % 2 === 0 ? anna("Yes.") : petr("word ".repeat(200)),
    );
    const error = thrown(() => buildModelInput(params(segments)));
    expect(error).toBeInstanceOf(AnalysisError);
    expect(error).toMatchObject({ code: "transcript_too_long", retryable: false });
  });
});

function text(value: string): BetaContentBlock {
  return { type: "text", text: value, citations: null };
}

function message(content: BetaContentBlock[], stopReason: BetaStopReason = "end_turn"): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 3400,
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 2100,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      server_tool_use: null,
      service_tier: null,
      speed: null,
      output_tokens_details: null,
    },
  };
}

const okJson = JSON.stringify(resultOk);

function withFirstFinding(change: (finding: Record<string, unknown>) => Record<string, unknown>[]): string {
  const [first, ...rest] = resultOk.findings;
  if (first === undefined) throw new Error("result-ok has no findings");
  return JSON.stringify({ ...resultOk, findings: [...change(first), ...rest] });
}

describe("interpretFinalMessage", () => {
  it("returns the result of a valid answer", () => {
    expect(interpretFinalMessage(message([text(okJson)]))).toEqual(AnalysisResult.parse(resultOk));
  });

  it.each([
    ["invalid JSON", okJson.slice(0, -10)],
    ["a bad pattern key", withFirstFinding((f) => [{ ...f, patternKey: "register.Swearing" }])],
    ["a repeated pattern key", withFirstFinding((f) => [f, f])],
    ["a finding without match terms", withFirstFinding((f) => [{ ...f, matchTerms: [] }])],
    ["a fourth finding", withFirstFinding((f) => [f, { ...f, patternKey: "grammar.articles.another_one" }])],
    [
      "a prefix term shorter than 4 characters",
      withFirstFinding((f) => [{ ...f, matchTerms: [{ text: "shi", lang: "en", mode: "prefix" }] }]),
    ],
  ])("fails with analysis_invalid on %s", (_, answer) => {
    const error = thrown(() => interpretFinalMessage(message([text(answer)])));
    expect(error).toMatchObject({ code: "analysis_invalid", retryable: false });
  });

  it("keeps the error free of the answer text", () => {
    const error = thrown(() => interpretFinalMessage(message([text("Ich kann nicht {")])));
    expect(String((error as Error).message)).not.toContain("Ich kann");
  });

  it("takes the last text block after the last fallback block", () => {
    const fallback: BetaContentBlock = {
      type: "fallback",
      from: { model: "claude-opus-5-5" },
      to: { model: "claude-opus-4-8" },
      trigger: { type: "refusal", category: "cyber" },
    };
    const result = interpretFinalMessage(message([text('{"status": "ok", "lang'), fallback, text(okJson)]));
    expect(result.findings).toHaveLength(resultOk.findings.length);

    const error = thrown(() => interpretFinalMessage(message([text(okJson), fallback])));
    expect(error).toMatchObject({ code: "analysis_invalid" });
  });

  it("fails with analysis_refused on a refusal", () => {
    const refused = {
      ...message([], "refusal"),
      stop_details: { type: "refusal", category: null, explanation: null },
    };
    const error = thrown(() => interpretFinalMessage(refused as BetaMessage));
    expect(error).toMatchObject({ code: "analysis_refused", retryable: false });
  });

  it("fails with analysis_truncated at max_tokens", () => {
    const error = thrown(() => interpretFinalMessage(message([text(okJson.slice(0, 500))], "max_tokens")));
    expect(error).toMatchObject({ code: "analysis_truncated", retryable: false });
  });
});

const HEADERS = new Headers();

describe("SDK errors", () => {
  it.each([
    ["RateLimitError", new Anthropic.RateLimitError(429, undefined, "rate limited", HEADERS), true],
    ["InternalServerError 500", new Anthropic.InternalServerError(500, undefined, "server", HEADERS), true],
    ["overloaded 529", Anthropic.APIError.generate(529, undefined, "overloaded", HEADERS), true],
    ["APIConnectionError", new Anthropic.APIConnectionError({ message: "reset" }), true],
    ["APIConnectionTimeoutError", new Anthropic.APIConnectionTimeoutError(), true],
    ["AuthenticationError", new Anthropic.AuthenticationError(401, undefined, "bad key", HEADERS), false],
    ["BadRequestError", new Anthropic.BadRequestError(400, undefined, "bad request", HEADERS), false],
    ["PermissionDeniedError", new Anthropic.PermissionDeniedError(403, undefined, "denied", HEADERS), false],
    ["NotFoundError", new Anthropic.NotFoundError(404, undefined, "no model", HEADERS), false],
    ["ConflictError", new Anthropic.ConflictError(409, undefined, "conflict", HEADERS), false],
    [
      "UnprocessableEntityError",
      new Anthropic.UnprocessableEntityError(422, undefined, "bad", HEADERS),
      false,
    ],
  ])("%s becomes analysis_failed", (_, sdkError, retryable) => {
    const error = fromSdkError(sdkError);
    expect(error).toBeInstanceOf(AnalysisError);
    expect(error).toMatchObject({ code: "analysis_failed", retryable });
  });

  it("leaves other errors unchanged", () => {
    const other = new TypeError("boom");
    expect(fromSdkError(other)).toBe(other);
  });
});

function fakeClient(answer: BetaMessage | Error): { client: StreamClient; calls: BetaMessageStreamParams[] } {
  const calls: BetaMessageStreamParams[] = [];
  const client: StreamClient = {
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          return {
            finalMessage: async () => {
              if (answer instanceof Error) throw answer;
              return answer;
            },
          };
        },
      },
    },
  };
  return { client, calls };
}

const INPUT: ModelInput = {
  kind: "call",
  userMessage: "Learner\n...",
  learnerWordCount: 40,
  learnerLines: meeting.data.transcript.filter((s) => s.speakerName === "Petr Ivanov").map((s) => s.text),
};

describe("ClaudeModel", () => {
  it("sends the documented request and reads the answer", async () => {
    const { client, calls } = fakeClient(message([text(okJson)]));
    const model = new ClaudeModel({ client, model: "claude-opus-5-5", effort: "high" });
    const output = await model.analyze(INPUT);

    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      system: [{ type: "text", text: systemPrompt("call"), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: INPUT.userMessage }],
      output_config: { effort: "high", format: { type: "json_schema" } },
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
    expect(request).not.toHaveProperty("thinking");
    expect(request).not.toHaveProperty("temperature");
    expect(request?.output_config?.format).not.toHaveProperty("parse");
    expect(request?.output_config?.format?.schema).toHaveProperty("properties.findings");

    expect(output).toMatchObject({
      model: "claude-opus-5-5",
      inputTokens: 1500,
      outputTokens: 3400,
      cacheReadTokens: 2100,
      unmatchedQuotes: 0,
    });
    expect(output.result.status).toBe("ok");
  });

  it("sends the written-language system prompt for chat and text", async () => {
    const { client, calls } = fakeClient(message([text(okJson)]));
    const model = new ClaudeModel({ client, model: "claude-opus-5-5", effort: "medium" });
    await model.analyze({ ...INPUT, kind: "chat" });
    await model.analyze({ ...INPUT, kind: "text" });
    const texts = calls.map((c) => (Array.isArray(c.system) ? c.system[0]?.text : c.system));
    expect(texts).toEqual([systemPrompt("chat"), systemPrompt("chat")]);
    expect(systemPrompt("text")).toBe(systemPrompt("chat"));
  });

  it("turns SDK errors into analysis errors", async () => {
    const { client } = fakeClient(new Anthropic.RateLimitError(429, undefined, "rate limited", HEADERS));
    const model = new ClaudeModel({ client, model: "claude-opus-5-5", effort: "high" });
    await expect(model.analyze(INPUT)).rejects.toMatchObject({ code: "analysis_failed", retryable: true });
  });
});

describe("FixtureModel", () => {
  it("returns result-ok without tokens", async () => {
    const output = await new FixtureModel().analyze(INPUT);
    expect(output).toEqual({
      result: AnalysisResult.parse(resultOk),
      model: "fixture",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      durationMs: 0,
      unmatchedQuotes: 0,
    });
  });
});

describe("createModel", () => {
  const env = {
    ANALYSIS_MODE: "claude",
    ANALYSIS_MODEL: "claude-opus-5-5",
    ANALYSIS_EFFORT: "high",
    ANTHROPIC_API_KEY: "sk-ant-test",
  };

  it("picks the model by ANALYSIS_MODE", () => {
    expect(createModel({ ...env, ANALYSIS_MODE: "fixture" })).toBeInstanceOf(FixtureModel);
    const claude = createModel(env);
    expect(claude).toBeInstanceOf(ClaudeModel);
    expect(claude.name).toBe("claude-opus-5-5");
  });

  it("throws on a bad mode, a bad effort or a missing key", () => {
    expect(() => createModel({ ...env, ANALYSIS_MODE: "openai" })).toThrow(/unknown ANALYSIS_MODE/);
    expect(() => createModel({ ...env, ANALYSIS_EFFORT: "extreme" })).toThrow(/unknown ANALYSIS_EFFORT/);
    expect(() => createModel({ ...env, ANTHROPIC_API_KEY: undefined })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("the quote check", () => {
  const result = AnalysisResult.parse(resultOk);
  const quotes = result.findings.flatMap((f) => f.examples).length;

  it("finds quotes ignoring case, punctuation and extra spaces", () => {
    expect(countUnmatchedQuotes(result, INPUT.learnerLines)).toBe(0);
    const shouted = INPUT.learnerLines.map((line) => `  ${line.toUpperCase().replaceAll(" ", "  ")}!!`);
    expect(countUnmatchedQuotes(result, shouted)).toBe(0);
  });

  it("counts example quotes that are not in the learner's lines", () => {
    expect(countUnmatchedQuotes(result, [])).toBe(quotes);
    const withoutDashboard = INPUT.learnerLines.filter((line) => !line.includes("dashboard"));
    expect(countUnmatchedQuotes(result, withoutDashboard)).toBe(1);
  });

  it("matches whole words only", () => {
    const [finding] = result.findings;
    if (finding === undefined) throw new Error("result-ok has no findings");
    const one = { ...result, findings: [{ ...finding, examples: [{ quote: "is good", correction: "x" }] }] };
    expect(countUnmatchedQuotes(one, ["this good"])).toBe(1);
    expect(countUnmatchedQuotes(one, ["it is good, yes"])).toBe(0);
  });
});

describe("runAnalysis", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs ids, counts and timings, and no text", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => logs.push(line));
    await runAnalysis(new FixtureModel(), INPUT, { rid: "abcdefabcdef", transcriptId: "trn_1" });

    const events = logs.map((line) => JSON.parse(line));
    expect(events.map((e) => e.evt)).toEqual(["analysis_model_start", "analysis_model_end"]);
    expect(events[1]).toMatchObject({
      transcript: "trn_1",
      model: "fixture",
      promptVersion: PROMPT_VERSION,
      language: "en",
      findings: resultOk.findings.length,
      unmatchedQuotes: 0,
    });
    expect(logs.join("\n")).not.toContain("agree");
  });

  it("logs the error code when the model fails", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((line: string) => errors.push(line));
    const { client } = fakeClient(message([text("{}")], "max_tokens"));
    const model = new ClaudeModel({ client, model: "claude-opus-5-5", effort: "high" });

    await expect(
      runAnalysis(model, INPUT, { rid: "abcdefabcdef", transcriptId: "trn_1" }),
    ).rejects.toBeInstanceOf(AnalysisError);
    expect(JSON.parse(errors[0] ?? "{}")).toMatchObject({
      evt: "analysis_model_failed",
      code: "analysis_truncated",
      retryable: false,
    });
  });
});

describe("system prompts", () => {
  it("give calls the spoken-language rules and chat and text the written ones", () => {
    const call = systemPrompt("call");
    const written = systemPrompt("text");
    expect(call).not.toBe(written);
    expect(call).toContain("This is a call");
    expect(call).toContain("Never spelling or punctuation.");
    expect(call).not.toContain("This is written text");
    expect(written).toContain("This is written text");
    expect(written).not.toContain("This is a call");
    for (const prompt of [call, written]) {
      expect(prompt).toContain("Return at most 3 findings and at most 3 words");
      expect(prompt).not.toMatch(/summary|rewrite|estimatedLevel/i);
    }
  });
});

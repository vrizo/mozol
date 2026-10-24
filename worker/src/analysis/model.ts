// The model that turns a model input into an AnalysisResult: Claude through the Anthropic SDK, or the fixture
// result without any call (docs/backend/ai-analysis.md).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaTextBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AnalysisResult, normalizeText } from "shared";
import resultOk from "shared/fixtures/analysis/result-ok.json";
import type { Env } from "../env";
import { log, logError } from "../log";
import { AnalysisError, fromSdkError } from "./errors";
import type { ModelInput } from "./input";
import { PROMPT_VERSION, systemPrompt } from "./prompt";

export type ModelOutput = {
  result: AnalysisResult;
  // The model that answered: the fallback model when the requested one declined.
  model: string;
  // Input tokens not read from the cache, cache writes included.
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number;
  unmatchedQuotes: number;
};

export type AnalysisModel = {
  // The model asked first.
  readonly name: string;
  analyze(input: ModelInput): Promise<ModelOutput>;
};

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const MAX_TOKENS = 64_000;
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Only the JSON schema: with the helper's parse function the SDK stream would parse every text block itself and
// fail before interpretFinalMessage sees the stop reason.
const { type: formatType, schema: formatSchema } = zodOutputFormat(AnalysisResult);
const OUTPUT_FORMAT = { type: formatType, schema: formatSchema };

// The part of the SDK client the model uses; tests pass a fake.
export type StreamClient = {
  beta: { messages: { stream(params: BetaMessageStreamParams): { finalMessage(): Promise<BetaMessage> } } };
};

export class ClaudeModel implements AnalysisModel {
  readonly name: string;
  private readonly client: StreamClient;
  private readonly effort: Effort;

  constructor(options: { client: StreamClient; model: string; effort: Effort }) {
    this.client = options.client;
    this.name = options.model;
    this.effort = options.effort;
  }

  request(input: ModelInput): BetaMessageStreamParams {
    return {
      model: this.name,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: systemPrompt(input.kind), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: input.userMessage }],
      output_config: { effort: this.effort, format: OUTPUT_FORMAT },
      fallbacks: "default",
      betas: [FALLBACK_BETA],
    };
  }

  async analyze(input: ModelInput): Promise<ModelOutput> {
    const started = Date.now();
    let message: BetaMessage;
    try {
      message = await this.client.beta.messages.stream(this.request(input)).finalMessage();
    } catch (error) {
      throw fromSdkError(error);
    }
    const durationMs = Date.now() - started;
    const result = interpretFinalMessage(message);
    const { usage } = message;
    return {
      result,
      model: message.model,
      inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0),
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      durationMs,
      unmatchedQuotes: countUnmatchedQuotes(result, input.learnerLines),
    };
  }
}

// The result of a final message, or the error it ends in. With a refusal fallback the content can hold the
// declined model's text, a fallback block and the answer: the result is the last text block after the last
// fallback block.
export function interpretFinalMessage(message: BetaMessage): AnalysisResult {
  if (message.stop_reason === "refusal") {
    throw new AnalysisError(
      "analysis_refused",
      false,
      `category ${message.stop_details?.category ?? "none"}`,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new AnalysisError("analysis_truncated", false, `${message.usage.output_tokens} output tokens`);
  }
  let answer: BetaTextBlock | undefined;
  for (const block of message.content) {
    if (block.type === "fallback") answer = undefined;
    if (block.type === "text") answer = block;
  }
  if (answer === undefined) {
    throw new AnalysisError("analysis_invalid", false, `no text block, stop reason ${message.stop_reason}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(answer.text);
  } catch {
    // The parser's message quotes the text, so it stays out of the error.
    throw new AnalysisError("analysis_invalid", false, "the answer is not JSON");
  }
  const parsed = AnalysisResult.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}:${i.code}`);
    throw new AnalysisError("analysis_invalid", false, issues.join(", "));
  }
  return parsed.data;
}

export class FixtureModel implements AnalysisModel {
  readonly name = "fixture";

  async analyze(input: ModelInput): Promise<ModelOutput> {
    const result = AnalysisResult.parse(resultOk);
    return {
      result,
      model: this.name,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      durationMs: 0,
      unmatchedQuotes: countUnmatchedQuotes(result, input.learnerLines),
    };
  }
}

export type ModelEnv = Pick<
  Env,
  "ANALYSIS_MODE" | "ANALYSIS_MODEL" | "ANALYSIS_EFFORT" | "ANTHROPIC_API_KEY"
>;

export function createModel(env: ModelEnv): AnalysisModel {
  switch (env.ANALYSIS_MODE) {
    case "fixture":
      return new FixtureModel();
    case "claude": {
      if (!env.ANTHROPIC_API_KEY) throw new Error("createModel: ANTHROPIC_API_KEY is not set");
      const effort = EFFORTS.find((e) => e === env.ANALYSIS_EFFORT);
      if (effort === undefined)
        throw new Error(`createModel: unknown ANALYSIS_EFFORT "${env.ANALYSIS_EFFORT}"`);
      // The pipeline step retries (docs/backend/pipeline.md), so the SDK does not.
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
      return new ClaudeModel({ client, model: env.ANALYSIS_MODEL, effort });
    }
    default:
      throw new Error(`createModel: unknown ANALYSIS_MODE "${env.ANALYSIS_MODE}"`);
  }
}

// The example quotes that are not in any of the learner's lines, comparing normalized text on whole words. The
// result itself stays unchanged.
export function countUnmatchedQuotes(result: AnalysisResult, learnerLines: string[]): number {
  const lines = learnerLines.map((line) => ` ${normalizeText(line)} `);
  const quotes = result.findings.flatMap((f) => f.examples.map((e) => e.quote));
  return quotes.filter((quote) => {
    const normalized = normalizeText(quote);
    return normalized === "" || !lines.some((line) => line.includes(` ${normalized} `));
  }).length;
}

// Calls the model and logs the start and the end with ids, counts and timings only.
export async function runAnalysis(
  model: AnalysisModel,
  input: ModelInput,
  context: { rid: string; transcriptId: string },
): Promise<ModelOutput> {
  const { rid, transcriptId } = context;
  const started = Date.now();
  log(rid, "analysis_model_start", {
    transcript: transcriptId,
    model: model.name,
    promptVersion: PROMPT_VERSION,
    kind: input.kind,
    learnerWords: input.learnerWordCount,
  });
  try {
    const output = await model.analyze(input);
    const { result } = output;
    log(rid, "analysis_model_end", {
      transcript: transcriptId,
      model: output.model,
      promptVersion: PROMPT_VERSION,
      status: result.status,
      language: result.language,
      findings: result.findings.length,
      words: result.words.length,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
      cacheReadTokens: output.cacheReadTokens,
      durationMs: output.durationMs,
      unmatchedQuotes: output.unmatchedQuotes,
    });
    return output;
  } catch (error) {
    logError(rid, "analysis_model_failed", {
      transcript: transcriptId,
      model: model.name,
      promptVersion: PROMPT_VERSION,
      code: error instanceof AnalysisError ? error.code : "internal",
      retryable: error instanceof AnalysisError ? error.retryable : null,
      error: error instanceof Error ? error.name : typeof error,
      detail: error instanceof AnalysisError ? error.message : null,
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

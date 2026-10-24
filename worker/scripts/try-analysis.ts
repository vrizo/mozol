// Runs the analysis model on one fixture transcript and writes analysis.json into a run folder
// (docs/backend/ai-analysis.md, "Tests and trying the prompt"). Started by scripts/try-analysis.sh, which passes
// the key in ANTHROPIC_API_KEY. Prints only counts and the path.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { AnalysisError } from "../src/analysis/errors";
import { buildModelInput } from "../src/analysis/input";
import { createModel, runAnalysis } from "../src/analysis/model";
import { PROMPT_VERSION } from "../src/analysis/prompt";
import { jamieAdapter } from "../src/sources/jamie";
import { jsonAdapter } from "../src/sources/json";
import { findLearner } from "../src/sources/learner";

// A sample user: Russian native speaker, no known patterns and no earlier levels.
const USER = { email: "petr.ivanov@example.com", speakerNames: ["Petr Ivanov"], nativeLanguage: "ru" };

const [fixturePath, runDir] = process.argv.slice(2);
if (fixturePath === undefined || runDir === undefined) {
  throw new Error("usage: try-analysis.ts <fixture path> <run folder>");
}
const outPath = join(runDir, "analysis.json");

// A Jamie webhook body names its event in metadata; any other fixture is a json source body.
const raw = readFileSync(fixturePath, "utf8");
const body = JSON.parse(raw) as { metadata?: { event?: unknown } };
const adapter = body.metadata?.event === undefined ? jsonAdapter : jamieAdapter;
const parsed = adapter.parse(raw, new Headers(), {
  receivedAt: new Date().toISOString(),
  userName: "Petr Ivanov",
});
if (parsed.outcome !== "transcript") {
  throw new Error(`${adapter.id} adapter: ${parsed.outcome === "refused" ? parsed.error : "ignored"}`);
}
const { transcript } = parsed;
const learner = findLearner(transcript, USER, adapter);
if (learner === null) throw new Error(`${adapter.id} adapter: no learner speaker for ${USER.email}`);

const input = buildModelInput({
  transcript: { kind: transcript.kind, segments: transcript.segments, learnerSpeakerId: learner.speakerId },
  user: USER,
  knownPatterns: [],
  levels: [],
});
const model = createModel({
  ANALYSIS_MODE: process.env.ANALYSIS_MODE ?? "claude",
  ANALYSIS_MODEL: process.env.ANALYSIS_MODEL ?? "claude-opus-5-5",
  ANALYSIS_EFFORT: process.env.ANALYSIS_EFFORT ?? "high",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
});
const run = {
  fixture: fixturePath,
  promptVersion: PROMPT_VERSION,
  requestedModel: model.name,
  learnerWordCount: input.learnerWordCount,
  compressed: input.compressed,
};
const rid = crypto.randomUUID().replaceAll("-", "").slice(0, 12);

try {
  const output = await runAnalysis(model, input, { rid, transcriptId: basename(fixturePath) });
  writeFileSync(outPath, `${JSON.stringify({ ...run, ...output }, null, 2)}\n`);
  const { result } = output;
  console.log(
    `status ${result.status}, language ${result.language}, findings ${result.findings.length}, ` +
      `words ${result.words.length}, phrases ${result.phrases.length}, rewrites ${result.rewrites.length}`,
  );
  console.log(
    `model ${output.model}, input ${output.inputTokens}, output ${output.outputTokens}, ` +
      `cache read ${output.cacheReadTokens} tokens, ${output.durationMs} ms, unmatched quotes ${output.unmatchedQuotes}`,
  );
} catch (error) {
  if (!(error instanceof AnalysisError)) throw error;
  const failure = { code: error.code, retryable: error.retryable, detail: error.message };
  writeFileSync(outPath, `${JSON.stringify({ ...run, error: failure }, null, 2)}\n`);
  console.log(`failed: ${error.code}, retryable ${error.retryable}`);
  process.exitCode = 1;
}
console.log(`written: ${outPath}`);

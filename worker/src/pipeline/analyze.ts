// The analyze step: builds the model input from D1, calls the model and writes the analyses row
// (docs/backend/pipeline.md, "Workflow", step 3; docs/backend/ai-analysis.md).
import { type AnalysisStatus, MatchTerm, type SourceKind } from "shared";
import { z } from "zod";
import { buildModelInput, type KnownPattern, MAX_KNOWN_PATTERNS } from "../analysis/input";
import { type AnalysisModel, runAnalysis as callModel, createModel } from "../analysis/model";
import { PROMPT_VERSION } from "../analysis/prompt";
import { readJson, writeJson } from "../db/json";
import { readSegments } from "../db/transcripts";
import type { Env } from "../env";
import { newId } from "../ids";
import { nowIso } from "../time";

export type AnalyzeOutcome =
  | { outcome: "stale" }
  | { outcome: "analyzed"; analysisId: string; status: AnalysisStatus };

const StoredTerms = z.array(MatchTerm);

export async function runAnalysis(
  env: Env,
  transcriptId: string,
  run: number,
  options: { rid: string; model?: AnalysisModel },
): Promise<AnalyzeOutcome> {
  const row = await env.DB.prepare(
    `SELECT t.run, t.user_id, t.kind, t.segments, t.learner_speaker_id, u.native_language
     FROM transcripts t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
  )
    .bind(transcriptId)
    .first<{
      run: number;
      user_id: string;
      kind: SourceKind;
      segments: string;
      learner_speaker_id: string | null;
      native_language: string;
    }>();
  if (row === null || row.run !== run) return { outcome: "stale" };
  if (row.learner_speaker_id === null) {
    throw new Error(`runAnalysis: transcript ${transcriptId} has no learner after the speaker step`);
  }

  const { results: patterns } = await env.DB.prepare(
    `SELECT language, key, title, match_terms, status, last_seen_at FROM patterns
     WHERE user_id = ? AND status = 'active' ORDER BY last_seen_at DESC, key LIMIT ?`,
  )
    .bind(row.user_id, MAX_KNOWN_PATTERNS)
    .all<{
      language: string;
      key: string;
      title: string;
      match_terms: string;
      status: "active";
      last_seen_at: string;
    }>();
  const knownPatterns: KnownPattern[] = patterns.map((p) => ({
    language: p.language,
    key: p.key,
    title: p.title,
    matchTerms: readJson(p.match_terms, StoredTerms, "patterns.match_terms"),
    status: p.status,
    lastSeenAt: p.last_seen_at,
  }));

  const input = buildModelInput({
    transcript: {
      kind: row.kind,
      segments: readSegments(row.segments),
      learnerSpeakerId: row.learner_speaker_id,
    },
    user: { nativeLanguage: row.native_language },
    knownPatterns,
  });
  const model = options.model ?? createModel(env);
  const output = await callModel(model, input, { rid: options.rid, transcriptId });

  const analysisId = newId("ana");
  await env.DB.prepare(
    `INSERT INTO analyses (id, transcript_id, user_id, run, prompt_version, model, status, language, result,
       input_tokens, output_tokens, cache_read_tokens, duration_ms, unmatched_quotes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (transcript_id) DO UPDATE SET id = excluded.id, run = excluded.run,
       prompt_version = excluded.prompt_version, model = excluded.model, status = excluded.status,
       language = excluded.language, result = excluded.result, input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens, cache_read_tokens = excluded.cache_read_tokens,
       duration_ms = excluded.duration_ms, unmatched_quotes = excluded.unmatched_quotes,
       created_at = excluded.created_at`,
  )
    .bind(
      analysisId,
      transcriptId,
      row.user_id,
      run,
      PROMPT_VERSION,
      output.model,
      output.result.status,
      output.result.language,
      writeJson(output.result),
      output.inputTokens,
      output.outputTokens,
      output.cacheReadTokens,
      output.durationMs,
      output.unmatchedQuotes,
      nowIso(),
    )
    .run();
  return { outcome: "analyzed", analysisId, status: output.result.status };
}

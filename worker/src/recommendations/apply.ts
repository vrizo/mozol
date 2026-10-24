// The recommend step: turns the transcript's analysis into recommendations and pending deliveries, and sets the
// transcript to analyzed (docs/backend/pipeline.md, "Recommendations"). Every change runs in one D1 batch.
import { AnalysisResult, type MatchTerm, marker, normalizeTerm, normalizeText } from "shared";
import { readJson, writeJson } from "../db/json";
import type { Env } from "../env";
import { newId } from "../ids";
import { nowIso } from "../time";
import { type Knowledge, type PatternKnowledge, rankItems, type WordStatus } from "./rank";
import { render } from "./render";

export type RecommendResult =
  | { outcome: "stale" }
  | { outcome: "analyzed"; userId: string; recommendations: number; deliveries: number; pending: number };

export async function recommend(env: Env, transcriptId: string, run: number): Promise<RecommendResult> {
  const db = env.DB;
  const row = await db
    .prepare(
      `SELECT t.run, t.user_id, a.run AS analysis_run, a.result
       FROM transcripts t LEFT JOIN analyses a ON a.transcript_id = t.id WHERE t.id = ?`,
    )
    .bind(transcriptId)
    .first<{ run: number; user_id: string; analysis_run: number | null; result: string | null }>();
  if (row === null || row.run !== run) return { outcome: "stale" };
  if (row.result === null || row.analysis_run !== run) {
    throw new Error(`recommend: transcript ${transcriptId} has no analysis of run ${run}`);
  }
  const result = readJson(row.result, AnalysisResult, "analyses.result");
  if (result.status !== "ok" || result.language === null) {
    throw new Error(`recommend: transcript ${transcriptId} has a result with status ${result.status}`);
  }
  const userId = row.user_id;
  const language = result.language;

  const ranked = await rankItems(result, await knowledge(db, userId, language, result));
  const delivered = await db
    .prepare(
      `SELECT r.item_key FROM recommendations r
       WHERE r.transcript_id = ? AND EXISTS (SELECT 1 FROM deliveries d WHERE d.recommendation_id = r.id)`,
    )
    .bind(transcriptId)
    .all<{ item_key: string }>();
  const keep = new Set(delivered.results.map((r) => r.item_key));

  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `DELETE FROM recommendations WHERE transcript_id = ?
         AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.recommendation_id = recommendations.id)`,
      )
      .bind(transcriptId),
  ];
  let recommendations = 0;
  let deliveries = 0;
  for (const [i, item] of ranked.entries()) {
    if (keep.has(item.itemKey)) continue;
    const id = newId("rec");
    const mark = await marker(language, item.itemKey);
    const texts = render(item);
    statements.push(
      db
        .prepare(
          `INSERT INTO recommendations (id, user_id, transcript_id, language, kind, item_key, marker, rank, title,
             notes, embed_line, match_terms, priority, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          userId,
          transcriptId,
          language,
          item.kind,
          item.itemKey,
          mark,
          i + 1,
          texts.title,
          texts.notes,
          texts.embedLine,
          writeJson(uniqueTerms(item.item.matchTerms.map(normalizeTerm))),
          texts.priority,
          writeJson(item.item),
          now,
        ),
    );
    recommendations++;
    if (!item.send) continue;
    statements.push(...newDelivery(db, { userId, recommendationId: id, marker: mark, now }));
    deliveries++;
  }

  statements.push(
    db
      .prepare(
        `UPDATE transcripts SET status = 'analyzed', analyzed_at = ?, skip_reason = NULL, error_code = NULL,
           updated_at = ?
         WHERE id = ? AND run = ?`,
      )
      .bind(now, now, transcriptId, run),
    db.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE user_id = ? AND status = 'pending'").bind(userId),
  );
  const results = await db.batch<{ n: number }>(statements);
  const pending = results.at(-1)?.results[0]?.n;
  if (pending === undefined) throw new Error("recommend: the pending count returned no row");
  return { outcome: "analyzed", userId, recommendations, deliveries, pending };
}

// A new pending delivery supersedes a pending (not claimed) delivery with the same marker.
function newDelivery(
  db: D1Database,
  d: { userId: string; recommendationId: string; marker: string; now: string },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE deliveries SET status = 'superseded', updated_at = ?
         WHERE user_id = ? AND marker = ? AND status = 'pending'`,
      )
      .bind(d.now, d.userId, d.marker),
    db
      .prepare(
        `INSERT INTO deliveries (id, user_id, recommendation_id, marker, status, failures, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .bind(newId("dlv"), d.userId, d.recommendationId, d.marker, d.now, d.now),
  ];
}

// Patterns and words of the result's items, by item key. The store step made them, so every item has one.
async function knowledge(
  db: D1Database,
  userId: string,
  language: string,
  result: AnalysisResult,
): Promise<Knowledge> {
  const [patterns, words] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT key, status, transcripts_count FROM patterns
         WHERE user_id = ? AND language = ? AND key IN (SELECT value FROM json_each(?))`,
      )
      .bind(userId, language, JSON.stringify(result.findings.map((f) => f.patternKey))),
    db
      .prepare(
        `SELECT word_key, status FROM words
         WHERE user_id = ? AND language = ? AND word_key IN (SELECT value FROM json_each(?))`,
      )
      .bind(userId, language, JSON.stringify(result.words.map((w) => normalizeText(w.term)))),
  ]);
  const patternRows = (patterns?.results ?? []) as {
    key: string;
    status: string;
    transcripts_count: number;
  }[];
  const wordRows = (words?.results ?? []) as { word_key: string; status: string }[];
  return {
    patterns: new Map(
      patternRows.map((p) => [
        p.key,
        { status: p.status as PatternKnowledge["status"], transcriptsCount: p.transcripts_count },
      ]),
    ),
    words: new Map(wordRows.map((w) => [`word:${w.word_key}`, w.status as WordStatus])),
  };
}

// The same normalized term twice in one item is kept once.
function uniqueTerms(terms: MatchTerm[]): MatchTerm[] {
  const seen = new Map<string, MatchTerm>();
  for (const term of terms) seen.set(JSON.stringify([term.text, term.lang, term.mode]), term);
  return [...seen.values()];
}

// The store step: turns the transcript's analysis into findings, word suggestions and keywords, and keeps the
// user's patterns and words right (docs/backend/pipeline.md, "Workflow", step 4; docs/backend/data-model.md).
// Every change runs in one D1 batch; running it twice leaves the same rows.
import { AnalysisResult, itemKey, type MatchTerm, normalizeTerm, normalizeText } from "shared";
import { readJson, writeJson } from "../db/json";
import type { Env } from "../env";
import { newId } from "../ids";
import { nowIso } from "../time";

// D1 allows 100 bound parameters per statement; id lists stay well below that.
const MAX_IDS_PER_STATEMENT = 50;
const KEYWORD_COLUMNS = 7;
const KEYWORD_ROWS_PER_STATEMENT = Math.floor(100 / KEYWORD_COLUMNS);

export type StoreOutcome = "stale" | "analyzed" | "skipped";

export type StoreResult = { outcome: StoreOutcome; statements: number };

type Touched = { patternIds: string[]; wordIds: string[] };

// Deletes the transcript's findings, word suggestions and keywords and recomputes the patterns and words they
// touched. Returns the number of statements of its batch.
export async function clearResults(env: Env, transcriptId: string): Promise<number> {
  const statements = await clearStatements(env.DB, transcriptId);
  await env.DB.batch(statements);
  return statements.length;
}

export async function storeResult(env: Env, transcriptId: string, run: number): Promise<StoreResult> {
  const row = await env.DB.prepare(
    `SELECT t.run, t.user_id, t.source, t.occurred_at, a.id AS analysis_id, a.run AS analysis_run, a.result
     FROM transcripts t LEFT JOIN analyses a ON a.transcript_id = t.id WHERE t.id = ?`,
  )
    .bind(transcriptId)
    .first<{
      run: number;
      user_id: string;
      source: string;
      occurred_at: string;
      analysis_id: string | null;
      analysis_run: number | null;
      result: string | null;
    }>();
  if (row === null || row.run !== run) return { outcome: "stale", statements: 0 };
  if (row.analysis_id === null || row.result === null || row.analysis_run !== run) {
    throw new Error(`storeResult: transcript ${transcriptId} has no analysis of run ${run}`);
  }
  const result = readJson(row.result, AnalysisResult, "analyses.result");
  const db = env.DB;
  const now = nowIso();

  if (result.status !== "ok") {
    const statements = await clearStatements(db, transcriptId);
    statements.push(
      db
        .prepare(
          `UPDATE transcripts SET status = 'skipped', skip_reason = ?, error_code = NULL, updated_at = ?
           WHERE id = ? AND run = ?`,
        )
        .bind(result.status, now, transcriptId, run),
    );
    await db.batch(statements);
    return { outcome: "skipped", statements: statements.length };
  }

  const language = result.language;
  if (language === null) throw new Error("storeResult: an ok result without a language");
  const userId = row.user_id;
  const seenAt = row.occurred_at;
  const touched = await touchedBy(db, transcriptId);
  const patternKeys = result.findings.map((f) => f.patternKey);
  const wordKeys = result.words.map((w) => normalizeText(w.term));

  const statements: D1PreparedStatement[] = [
    ...deleteRows(db, transcriptId),
    db
      .prepare("UPDATE transcripts SET language = ?, updated_at = ? WHERE id = ?")
      .bind(language, now, transcriptId),
  ];

  for (const finding of result.findings) {
    statements.push(
      db
        .prepare(
          `INSERT INTO patterns (id, user_id, language, key, category, title, match_terms, occurrences_total,
             transcripts_count, sources, first_seen_at, last_seen_at, status)
           VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 0, '[]', ?, ?, 'active')
           ON CONFLICT (user_id, language, key) DO NOTHING`,
        )
        .bind(
          newId("pat"),
          userId,
          language,
          finding.patternKey,
          finding.category,
          finding.title,
          seenAt,
          seenAt,
        ),
      db
        .prepare(
          `INSERT INTO findings (id, transcript_id, analysis_id, user_id, pattern_id, language, category, severity,
             occurrences, title, examples, explanation, tip, match_terms, created_at)
           VALUES (?, ?, ?, ?, (SELECT id FROM patterns WHERE user_id = ? AND language = ? AND key = ?),
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId("fnd"),
          transcriptId,
          row.analysis_id,
          userId,
          userId,
          language,
          finding.patternKey,
          language,
          finding.category,
          finding.severity,
          finding.occurrences,
          finding.title,
          writeJson(finding.examples),
          finding.explanation,
          finding.tip,
          writeJson(normalizedTerms(finding.matchTerms)),
          now,
        ),
    );
  }

  result.words.forEach((word, i) => {
    const wordKey = wordKeys[i] as string;
    statements.push(
      // A word keeps the term, type, translation and meaning of its newest suggestion.
      db
        .prepare(
          `INSERT INTO words (id, user_id, language, word_key, term, type, translation, meaning, example,
             example_translation, times_suggested, first_seen_at, last_seen_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'new')
           ON CONFLICT (user_id, language, word_key) DO UPDATE SET term = excluded.term, type = excluded.type,
             translation = excluded.translation, meaning = excluded.meaning
           WHERE excluded.last_seen_at >= words.last_seen_at`,
        )
        .bind(
          newId("wrd"),
          userId,
          language,
          wordKey,
          word.term,
          word.type,
          word.translation,
          word.meaning,
          word.example,
          word.exampleTranslation,
          seenAt,
          seenAt,
        ),
      db
        .prepare(
          `INSERT INTO word_suggestions (id, transcript_id, analysis_id, user_id, word_id, language, reason,
             learner_said, example, example_translation, match_terms, created_at)
           VALUES (?, ?, ?, ?, (SELECT id FROM words WHERE user_id = ? AND language = ? AND word_key = ?),
             ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId("wsg"),
          transcriptId,
          row.analysis_id,
          userId,
          userId,
          language,
          wordKey,
          language,
          word.reason,
          word.learnerSaid,
          word.example,
          word.exampleTranslation,
          writeJson(normalizedTerms(word.matchTerms)),
          now,
        ),
    );
  });

  statements.push(...insertKeywords(db, userId, transcriptId, language, await keywordRows(result)));
  statements.push(...recompute(db, touched, { userId, language, patternKeys, wordKeys }));

  // A learned pattern that appears again, in a transcript where it was not before, becomes active.
  const old = touched.patternIds;
  for (const keys of chunk(patternKeys)) {
    const notOld = old.length === 0 ? "" : `AND id NOT IN (${marks(old.length)})`;
    statements.push(
      db
        .prepare(
          `UPDATE patterns SET status = 'active'
           WHERE user_id = ? AND language = ? AND status = 'learned' AND key IN (${marks(keys.length)}) ${notOld}`,
        )
        .bind(userId, language, ...keys, ...old),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE transcripts SET status = 'analyzed', analyzed_at = ?, skip_reason = NULL, error_code = NULL,
           updated_at = ?
         WHERE id = ? AND run = ?`,
      )
      .bind(now, now, transcriptId, run),
  );
  await db.batch(statements);
  return { outcome: "analyzed", statements: statements.length };
}

async function clearStatements(db: D1Database, transcriptId: string): Promise<D1PreparedStatement[]> {
  const touched = await touchedBy(db, transcriptId);
  return [...deleteRows(db, transcriptId), ...recompute(db, touched, null)];
}

async function touchedBy(db: D1Database, transcriptId: string): Promise<Touched> {
  const [patterns, words] = await db.batch<{ id: string }>([
    db.prepare("SELECT DISTINCT pattern_id AS id FROM findings WHERE transcript_id = ?").bind(transcriptId),
    db
      .prepare("SELECT DISTINCT word_id AS id FROM word_suggestions WHERE transcript_id = ?")
      .bind(transcriptId),
  ]);
  return {
    patternIds: (patterns?.results ?? []).map((r) => r.id),
    wordIds: (words?.results ?? []).map((r) => r.id),
  };
}

function deleteRows(db: D1Database, transcriptId: string): D1PreparedStatement[] {
  return ["findings", "word_suggestions", "keywords"].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE transcript_id = ?`).bind(transcriptId),
  );
}

type NewKeys = { userId: string; language: string; patternKeys: string[]; wordKeys: string[] };

// Recomputes every pattern and word touched by the old rows (by id) or the new ones (by key), and deletes those
// with no rows left.
function recompute(db: D1Database, touched: Touched, fresh: NewKeys | null): D1PreparedStatement[] {
  const patternSets = [
    ...chunk(touched.patternIds).map((ids) => ({ where: `id IN (${marks(ids.length)})`, params: ids })),
    ...chunk(fresh?.patternKeys ?? []).map((keys) => ({
      where: `user_id = ? AND language = ? AND key IN (${marks(keys.length)})`,
      params: [fresh?.userId, fresh?.language, ...keys],
    })),
  ];
  const wordSets = [
    ...chunk(touched.wordIds).map((ids) => ({ where: `id IN (${marks(ids.length)})`, params: ids })),
    ...chunk(fresh?.wordKeys ?? []).map((keys) => ({
      where: `user_id = ? AND language = ? AND word_key IN (${marks(keys.length)})`,
      params: [fresh?.userId, fresh?.language, ...keys],
    })),
  ];
  return [
    ...patternSets.map(({ where, params }) =>
      db.prepare(`${RECOMPUTE_PATTERNS} WHERE ${where}`).bind(...params),
    ),
    ...wordSets.map(({ where, params }) => db.prepare(`${RECOMPUTE_WORDS} WHERE ${where}`).bind(...params)),
    ...patternSets.map(({ where, params }) =>
      db
        .prepare(
          `DELETE FROM patterns WHERE ${where} AND NOT EXISTS (SELECT 1 FROM findings f WHERE f.pattern_id = patterns.id)`,
        )
        .bind(...params),
    ),
    ...wordSets.map(({ where, params }) =>
      db
        .prepare(
          `DELETE FROM words WHERE ${where}
           AND NOT EXISTS (SELECT 1 FROM word_suggestions s WHERE s.word_id = words.id)`,
        )
        .bind(...params),
    ),
  ];
}

// Seen times are the times of the conversations; the newest finding is the one of the newest conversation.
const NEWEST_FINDING = `SELECT f.%s FROM findings f JOIN transcripts t ON t.id = f.transcript_id
  WHERE f.pattern_id = patterns.id ORDER BY t.occurred_at DESC, f.created_at DESC, f.id DESC LIMIT 1`;

const RECOMPUTE_PATTERNS = `UPDATE patterns SET
  occurrences_total = (SELECT COALESCE(SUM(f.occurrences), 0) FROM findings f WHERE f.pattern_id = patterns.id),
  transcripts_count = (SELECT COUNT(DISTINCT f.transcript_id) FROM findings f WHERE f.pattern_id = patterns.id),
  sources = COALESCE((SELECT json_group_array(source) FROM (SELECT DISTINCT t.source FROM findings f
    JOIN transcripts t ON t.id = f.transcript_id WHERE f.pattern_id = patterns.id ORDER BY t.source)), '[]'),
  first_seen_at = COALESCE((SELECT MIN(t.occurred_at) FROM findings f JOIN transcripts t ON t.id = f.transcript_id
    WHERE f.pattern_id = patterns.id), first_seen_at),
  last_seen_at = COALESCE((SELECT MAX(t.occurred_at) FROM findings f JOIN transcripts t ON t.id = f.transcript_id
    WHERE f.pattern_id = patterns.id), last_seen_at),
  category = COALESCE((${NEWEST_FINDING.replace("%s", "category")}), category),
  title = COALESCE((${NEWEST_FINDING.replace("%s", "title")}), title),
  match_terms = COALESCE((${NEWEST_FINDING.replace("%s", "match_terms")}), match_terms)`;

const NEWEST_SUGGESTION = `SELECT s.%s FROM word_suggestions s JOIN transcripts t ON t.id = s.transcript_id
  WHERE s.word_id = words.id ORDER BY t.occurred_at DESC, s.created_at DESC, s.id DESC LIMIT 1`;

const RECOMPUTE_WORDS = `UPDATE words SET
  times_suggested = (SELECT COUNT(*) FROM word_suggestions s WHERE s.word_id = words.id),
  first_seen_at = COALESCE((SELECT MIN(t.occurred_at) FROM word_suggestions s
    JOIN transcripts t ON t.id = s.transcript_id WHERE s.word_id = words.id), first_seen_at),
  last_seen_at = COALESCE((SELECT MAX(t.occurred_at) FROM word_suggestions s
    JOIN transcripts t ON t.id = s.transcript_id WHERE s.word_id = words.id), last_seen_at),
  example = COALESCE((${NEWEST_SUGGESTION.replace("%s", "example")}), example),
  example_translation = COALESCE((${NEWEST_SUGGESTION.replace("%s", "example_translation")}), example_translation)`;

type KeywordRow = { itemKey: string; term: MatchTerm };

// One row per normalized match term of every finding and word; a term that repeats inside one item is kept once.
async function keywordRows(result: AnalysisResult): Promise<KeywordRow[]> {
  const items = [
    ...(await Promise.all(
      result.findings.map(async (f) => ({ key: await itemKey("mistake", f), terms: f.matchTerms })),
    )),
    ...(await Promise.all(
      result.words.map(async (w) => ({ key: await itemKey("word", w), terms: w.matchTerms })),
    )),
  ];
  const rows = new Map<string, KeywordRow>();
  for (const { key, terms } of items) {
    for (const term of normalizedTerms(terms)) {
      rows.set(JSON.stringify([key, term.text, term.lang, term.mode]), { itemKey: key, term });
    }
  }
  return [...rows.values()];
}

function insertKeywords(
  db: D1Database,
  userId: string,
  transcriptId: string,
  language: string,
  rows: KeywordRow[],
): D1PreparedStatement[] {
  return chunk(rows, KEYWORD_ROWS_PER_STATEMENT).map((part) =>
    db
      .prepare(
        `INSERT INTO keywords (user_id, transcript_id, item_key, language, term, term_lang, mode)
         VALUES ${part.map(() => `(${marks(KEYWORD_COLUMNS)})`).join(", ")}`,
      )
      .bind(
        ...part.flatMap(({ itemKey: key, term }) => [
          userId,
          transcriptId,
          key,
          language,
          term.text,
          term.lang,
          term.mode,
        ]),
      ),
  );
}

function normalizedTerms(terms: MatchTerm[]): MatchTerm[] {
  return terms.map(normalizeTerm);
}

function chunk<T>(items: T[], size = MAX_IDS_PER_STATEMENT): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

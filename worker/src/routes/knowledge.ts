// /api/patterns and /api/words: the user's patterns and words (shared/CONTRACT.md, "Endpoints: patterns and words").
import { Hono } from "hono";
import {
  PatchPatternBody,
  PatchWordBody,
  PatternResponse,
  PatternsQuery,
  PatternsResponse,
  WordResponse,
  WordsQuery,
  WordsResponse,
} from "shared";
import { requireUser } from "../auth/session";
import {
  PATTERN_COLUMNS,
  type PatternRow,
  patternFromRow,
  WORD_COLUMNS,
  type WordRow,
  wordFromRow,
} from "../db/knowledge";
import type { AppEnv } from "../env";
import { ApiError, parseInput, readJson } from "../errors";

export const patternRoutes = new Hono<AppEnv>();

// Recurring patterns first, then the most recently seen.
patternRoutes.get("/", requireUser, async (c) => {
  const query = parseInput(PatternsQuery, c.req.query());
  const { results } = await c.env.DB.prepare(
    `SELECT ${PATTERN_COLUMNS} FROM patterns p
     WHERE p.user_id = ?1 AND p.status = ?2 AND (?3 IS NULL OR p.language = ?3)
     ORDER BY p.transcripts_count >= 2 DESC, p.last_seen_at DESC, p.key, p.language`,
  )
    .bind(c.var.user.id, query.status, query.language ?? null)
    .all<PatternRow>();
  return c.json(PatternsResponse.parse({ patterns: results.map(patternFromRow) }));
});

patternRoutes.patch("/:id", requireUser, async (c) => {
  const body = await readJson(c, PatchPatternBody);
  const id = c.req.param("id");
  const updated = await c.env.DB.prepare("UPDATE patterns SET status = ? WHERE id = ? AND user_id = ?")
    .bind(body.status, id, c.var.user.id)
    .run();
  if (updated.meta.changes === 0) throw new ApiError(404, "not_found");
  const row = await c.env.DB.prepare(`SELECT ${PATTERN_COLUMNS} FROM patterns p WHERE p.id = ?`)
    .bind(id)
    .first<PatternRow>();
  if (row === null) throw new Error("PATCH /api/patterns/:id: the pattern is gone");
  return c.json(PatternResponse.parse({ pattern: patternFromRow(row) }));
});

export const wordRoutes = new Hono<AppEnv>();

// The most recently seen first.
wordRoutes.get("/", requireUser, async (c) => {
  const query = parseInput(WordsQuery, c.req.query());
  const { results } = await c.env.DB.prepare(
    `SELECT ${WORD_COLUMNS} FROM words w
     WHERE w.user_id = ?1 AND w.status = ?2 AND (?3 IS NULL OR w.language = ?3)
     ORDER BY w.last_seen_at DESC, w.word_key, w.language`,
  )
    .bind(c.var.user.id, query.status, query.language ?? null)
    .all<WordRow>();
  return c.json(WordsResponse.parse({ words: results.map(wordFromRow) }));
});

wordRoutes.patch("/:id", requireUser, async (c) => {
  const body = await readJson(c, PatchWordBody);
  const id = c.req.param("id");
  const updated = await c.env.DB.prepare("UPDATE words SET status = ? WHERE id = ? AND user_id = ?")
    .bind(body.status, id, c.var.user.id)
    .run();
  if (updated.meta.changes === 0) throw new ApiError(404, "not_found");
  const row = await c.env.DB.prepare(`SELECT ${WORD_COLUMNS} FROM words w WHERE w.id = ?`)
    .bind(id)
    .first<WordRow>();
  if (row === null) throw new Error("PATCH /api/words/:id: the word is gone");
  return c.json(WordResponse.parse({ word: wordFromRow(row) }));
});

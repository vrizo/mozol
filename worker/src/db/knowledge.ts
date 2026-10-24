// The patterns and words tables and their mapping to the API Pattern and Word (shared/CONTRACT.md).
import { Example, Pattern, SourceId, Word } from "shared";
import { z } from "zod";
import { readJson } from "./json";

export type PatternRow = {
  id: string;
  language: string;
  key: string;
  category: string;
  title: string;
  status: string;
  occurrences_total: number;
  transcripts_count: number;
  sources: string;
  first_seen_at: string;
  last_seen_at: string;
  latest: string | null;
};

// Pattern.latest comes from the newest finding: the one of the newest conversation.
export const PATTERN_COLUMNS = `p.id, p.language, p.key, p.category, p.title, p.status, p.occurrences_total,
  p.transcripts_count, p.sources, p.first_seen_at, p.last_seen_at,
  (SELECT json_object('examples', json(f.examples), 'explanation', f.explanation, 'tip', f.tip)
   FROM findings f JOIN transcripts t ON t.id = f.transcript_id WHERE f.pattern_id = p.id
   ORDER BY t.occurred_at DESC, f.created_at DESC, f.id DESC LIMIT 1) AS latest`;

const Latest = z.strictObject({
  examples: z.array(Example),
  explanation: z.string(),
  tip: z.string().nullable(),
});

export function patternFromRow(row: PatternRow): Pattern {
  if (row.latest === null) throw new Error(`patternFromRow: pattern ${row.id} has no findings`);
  return Pattern.parse({
    id: row.id,
    language: row.language,
    key: row.key,
    category: row.category,
    title: row.title,
    status: row.status,
    recurring: row.transcripts_count >= 2,
    occurrencesTotal: row.occurrences_total,
    transcriptsCount: row.transcripts_count,
    sources: readJson(row.sources, z.array(SourceId), "patterns.sources"),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    latest: readJson(row.latest, Latest, "findings (latest)"),
  });
}

export type WordRow = {
  id: string;
  language: string;
  term: string;
  type: string;
  translation: string;
  meaning: string;
  example: string;
  example_translation: string;
  status: string;
  times_suggested: number;
  first_seen_at: string;
  last_seen_at: string;
};

export const WORD_COLUMNS = `w.id, w.language, w.term, w.type, w.translation, w.meaning, w.example,
  w.example_translation, w.status, w.times_suggested, w.first_seen_at, w.last_seen_at`;

export function wordFromRow(row: WordRow): Word {
  return Word.parse({
    id: row.id,
    language: row.language,
    term: row.term,
    type: row.type,
    translation: row.translation,
    meaning: row.meaning,
    example: row.example,
    exampleTranslation: row.example_translation,
    status: row.status,
    timesSuggested: row.times_suggested,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  });
}

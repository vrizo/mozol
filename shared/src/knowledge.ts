// Patterns and words the user collects across transcripts.
import { z } from "zod";
import { Category, FindingObject, PatternKey, WordType } from "./analysis";
import { Id, LanguageCode, SourceId, Time } from "./common";

export const PatternStatus = z.enum(["active", "learned", "dismissed"]);
export type PatternStatus = z.infer<typeof PatternStatus>;

const Count = z.number().int().min(0);

export const Pattern = z.strictObject({
  id: Id,
  language: LanguageCode,
  key: PatternKey,
  category: Category,
  title: z.string(),
  status: PatternStatus,
  // Seen in 2 or more transcripts.
  recurring: z.boolean(),
  occurrencesTotal: Count,
  transcriptsCount: Count,
  sources: z.array(SourceId),
  firstSeenAt: Time,
  lastSeenAt: Time,
  latest: FindingObject.pick({ examples: true, explanation: true, tip: true }),
});
export type Pattern = z.infer<typeof Pattern>;

export const WordStatus = z.enum(["new", "learning", "known", "dismissed"]);
export type WordStatus = z.infer<typeof WordStatus>;

export const Word = z.strictObject({
  id: Id,
  language: LanguageCode,
  term: z.string(),
  type: WordType,
  translation: z.string(),
  meaning: z.string(),
  example: z.string(),
  exampleTranslation: z.string(),
  status: WordStatus,
  timesSuggested: z.number().int().min(1),
  firstSeenAt: Time,
  lastSeenAt: Time,
});
export type Word = z.infer<typeof Word>;

export const PatternsQuery = z.strictObject({ status: PatternStatus, language: LanguageCode.optional() });
export type PatternsQuery = z.infer<typeof PatternsQuery>;

export const WordsQuery = z.strictObject({ status: WordStatus, language: LanguageCode.optional() });
export type WordsQuery = z.infer<typeof WordsQuery>;

export const PatchPatternBody = z.strictObject({ status: PatternStatus });
export type PatchPatternBody = z.infer<typeof PatchPatternBody>;

export const PatchWordBody = z.strictObject({ status: WordStatus });
export type PatchWordBody = z.infer<typeof PatchWordBody>;

export const PatternsResponse = z.strictObject({ patterns: z.array(Pattern) });
export type PatternsResponse = z.infer<typeof PatternsResponse>;

export const PatternResponse = z.strictObject({ pattern: Pattern });
export type PatternResponse = z.infer<typeof PatternResponse>;

export const WordsResponse = z.strictObject({ words: z.array(Word) });
export type WordsResponse = z.infer<typeof WordsResponse>;

export const WordResponse = z.strictObject({ word: Word });
export type WordResponse = z.infer<typeof WordResponse>;

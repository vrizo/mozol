// The analysis result the model returns (structured output), with the rules JSON Schema cannot express.
import { z } from "zod";
import { LanguageCode, Level } from "./common";
import { MatchTermError, normalizeTerm, normalizeText } from "./matching";

export const Category = z.enum([
  "grammar",
  "vocabulary",
  "phrasing",
  "register",
  "fluency",
  "spelling",
  "punctuation",
]);
export type Category = z.infer<typeof Category>;

export const PATTERN_KEY = /^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/;
export const PatternKey = z.string().max(64).regex(PATTERN_KEY);

export const MatchTermMode = z.enum(["word", "prefix", "phrase", "substring"]);
export type MatchTermMode = z.infer<typeof MatchTermMode>;

// Mode rules, checked on the normalized text: word and prefix terms are one token, prefix terms have at least
// 4 characters, phrase terms have at least 2 tokens.
export const MatchTerm = z
  .strictObject({
    text: z.string().min(1).max(60),
    lang: LanguageCode,
    mode: MatchTermMode,
  })
  .superRefine((term, ctx) => {
    try {
      normalizeTerm(term);
    } catch (error) {
      if (!(error instanceof MatchTermError)) throw error;
      ctx.addIssue({ code: "custom", path: ["text"], message: `match term ${error.problem}` });
    }
  });
export type MatchTerm = z.infer<typeof MatchTerm>;

const MatchTerms = z.array(MatchTerm).max(8);

export const Severity = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof Severity>;

export const Example = z.strictObject({ quote: z.string(), correction: z.string() });
export type Example = z.infer<typeof Example>;

// Without the category rule: Pattern.latest picks fields from it.
export const FindingObject = z.strictObject({
  patternKey: PatternKey,
  category: Category,
  title: z.string().max(60),
  severity: Severity,
  occurrences: z.number().int().min(1),
  examples: z.array(Example).min(1).max(3),
  explanation: z.string(),
  tip: z.string().nullable(),
  matchTerms: MatchTerms,
});

export const Finding = FindingObject.superRefine((finding, ctx) => {
  if (finding.patternKey.split(".")[0] !== finding.category) {
    ctx.addIssue({ code: "custom", path: ["category"], message: "category differs from the pattern key" });
  }
});
export type Finding = z.infer<typeof Finding>;

export const WordType = z.enum(["word", "phrasal_verb", "collocation", "idiom", "phrase"]);
export type WordType = z.infer<typeof WordType>;

export const WordSuggestion = z.strictObject({
  term: z.string(),
  type: WordType,
  reason: z.enum(["misused", "better_choice", "overused_alternative", "missing_word"]),
  learnerSaid: z.string().nullable(),
  translation: z.string(),
  meaning: z.string(),
  example: z.string(),
  exampleTranslation: z.string(),
  matchTerms: z.array(MatchTerm).min(1).max(8),
});
export type WordSuggestion = z.infer<typeof WordSuggestion>;

export const Phrase = z.strictObject({
  phrase: z.string(),
  useWhen: z.string(),
  translation: z.string(),
  insteadOf: z.string().nullable(),
  matchTerms: MatchTerms,
});
export type Phrase = z.infer<typeof Phrase>;

export const Rewrite = z.strictObject({
  original: z.string(),
  rewrite: z.string(),
  note: z.string(),
  matchTerms: MatchTerms,
});
export type Rewrite = z.infer<typeof Rewrite>;

export const AnalysisStatus = z.enum(["ok", "too_little_speech", "native_language"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

export const AnalysisResult = z
  .strictObject({
    status: AnalysisStatus,
    language: LanguageCode.nullable(),
    summary: z.strictObject({
      overview: z.string(),
      estimatedLevel: Level.nullable(),
      strengths: z.array(z.string()).max(3),
      focus: z.string(),
    }),
    findings: z.array(Finding),
    words: z.array(WordSuggestion),
    phrases: z.array(Phrase),
    rewrites: z.array(Rewrite),
  })
  .superRefine((result, ctx) => {
    if (result.language === null && result.status !== "too_little_speech") {
      ctx.addIssue({
        code: "custom",
        path: ["language"],
        message: "language is null only with too_little_speech",
      });
    }
    if (result.status !== "ok") {
      for (const list of ["findings", "words", "phrases", "rewrites"] as const) {
        if (result[list].length > 0) {
          ctx.addIssue({ code: "custom", path: [list], message: "lists are empty when status is not ok" });
        }
      }
      if (result.summary.focus !== "") {
        ctx.addIssue({
          code: "custom",
          path: ["summary", "focus"],
          message: "focus is empty when status is not ok",
        });
      }
    }

    const patternKeys = new Set<string>();
    result.findings.forEach((finding, i) => {
      if (patternKeys.has(finding.patternKey)) {
        ctx.addIssue({ code: "custom", path: ["findings", i, "patternKey"], message: "pattern key repeats" });
      }
      patternKeys.add(finding.patternKey);
    });

    const wordKeys = new Set<string>();
    result.words.forEach((word, i) => {
      const key = normalizeText(word.term);
      if (key === "") {
        ctx.addIssue({ code: "custom", path: ["words", i, "term"], message: "word key is empty" });
      } else if (wordKeys.has(key)) {
        ctx.addIssue({ code: "custom", path: ["words", i, "term"], message: "word key repeats" });
      }
      wordKeys.add(key);
    });

    // Phrases and rewrites get their item keys from the normalized text.
    result.phrases.forEach((phrase, i) => {
      if (normalizeText(phrase.phrase) === "") {
        ctx.addIssue({ code: "custom", path: ["phrases", i, "phrase"], message: "phrase is empty" });
      }
    });
    result.rewrites.forEach((rewrite, i) => {
      if (normalizeText(rewrite.original) === "") {
        ctx.addIssue({ code: "custom", path: ["rewrites", i, "original"], message: "original is empty" });
      }
    });
  });
export type AnalysisResult = z.infer<typeof AnalysisResult>;

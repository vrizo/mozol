// Text normalization, match terms, item keys and markers (shared/CONTRACT.md). The iOS app follows this file and
// shared/fixtures/matching/cases.json.
import type { Finding, MatchTerm, Phrase, Rewrite, WordSuggestion } from "./analysis";
import type { RecommendationKind } from "./recommendations";

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function tokens(normalized: string): string[] {
  return normalized === "" ? [] : normalized.split(" ");
}

export type MatchTermProblem = "empty" | "has_space" | "prefix_too_short" | "phrase_too_short";

export class MatchTermError extends Error {
  constructor(readonly problem: MatchTermProblem) {
    super(`match term: ${problem}`);
    this.name = "MatchTermError";
  }
}

// The term with its text normalized. A term that breaks the mode rules throws MatchTermError.
export function normalizeTerm(term: MatchTerm): MatchTerm {
  const text = normalizeText(term.text);
  if (text === "") throw new MatchTermError("empty");
  if ((term.mode === "word" || term.mode === "prefix") && text.includes(" ")) {
    throw new MatchTermError("has_space");
  }
  if (term.mode === "prefix" && [...text].length < 4) throw new MatchTermError("prefix_too_short");
  if (term.mode === "phrase" && tokens(text).length < 2) throw new MatchTermError("phrase_too_short");
  return { ...term, text };
}

export function termMatches(term: MatchTerm, normalizedText: string): boolean {
  const { text, mode } = normalizeTerm(term);
  const textTokens = tokens(normalizedText);
  switch (mode) {
    case "word":
      return textTokens.includes(text);
    case "prefix":
      return textTokens.some((token) => token.startsWith(text));
    case "phrase":
      return containsSequence(textTokens, tokens(text));
    case "substring":
      return normalizedText.includes(text);
  }
}

// The number of terms that match the text. The caller leaves out the lines MOZOL added.
export function scoreText(terms: MatchTerm[], text: string): number {
  const normalized = normalizeText(text);
  return terms.filter((term) => termMatches(term, normalized)).length;
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((token, i) => haystack[start + i] === token)) return true;
  }
  return false;
}

export type KeyedItem = {
  mistake: Pick<Finding, "patternKey">;
  word: Pick<WordSuggestion, "term">;
  phrase: Pick<Phrase, "phrase">;
  rewrite: Pick<Rewrite, "original">;
};

const itemKeyOf: { [K in RecommendationKind]: (item: KeyedItem[K]) => Promise<string> } = {
  mistake: async (item) => item.patternKey,
  word: async (item) => `word:${nonEmptyNormalized(item.term)}`,
  phrase: async (item) => `phrase:${nonEmptyNormalized(item.phrase)}`,
  rewrite: async (item) => `rewrite:${(await sha256Hex(nonEmptyNormalized(item.original))).slice(0, 16)}`,
};

export function itemKey<K extends RecommendationKind>(kind: K, item: KeyedItem[K]): Promise<string> {
  return itemKeyOf[kind](item);
}

export async function marker(language: string, key: string): Promise<string> {
  return (await sha256Hex(`${language}:${key}`)).slice(0, 8);
}

function nonEmptyNormalized(text: string): string {
  const normalized = normalizeText(text);
  if (normalized === "") throw new Error("item text is empty after normalization");
  return normalized;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

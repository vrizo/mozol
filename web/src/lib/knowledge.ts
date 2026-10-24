// Pure helpers for the patterns, words and recommendations pages.
import type { MatchTerm } from "shared";
import { copy } from "../copy/en";

const t = copy.recommendations;

export const matchModeLabel = (mode: MatchTerm["mode"]) => t.modes[mode];

// Distinct languages of a list, sorted, for the language filter.
export function languagesOf(items: { language: string }[]): string[] {
  return [...new Set(items.map((item) => item.language))].sort();
}

export function filterByLanguage<T extends { language: string }>(items: T[], language: string | null): T[] {
  return language ? items.filter((item) => item.language === language) : items;
}

// A query value from the URL, or the first allowed value when it is missing or unknown.
export function pickStatus<T extends string>(value: string | null, allowed: readonly T[]): T {
  const first = allowed[0];
  if (first === undefined) throw new Error("no allowed values");
  return allowed.find((item) => item === value) ?? first;
}

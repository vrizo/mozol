// Text normalization, match terms, item keys and markers. The iOS app runs the same matching cases.
import { describe, expect, test } from "vitest";
import cases from "../fixtures/matching/cases.json";
import {
  itemKey,
  MatchTerm,
  MatchTermError,
  marker,
  normalizeTerm,
  normalizeText,
  scoreText,
  termMatches,
  tokens,
} from "../src";

describe("matching cases", () => {
  test("there are at least 25 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
  });

  test.each(cases)("$note", (c) => {
    const terms = c.terms.map((t) => MatchTerm.parse(t));
    expect(scoreText(terms, c.text)).toBe(c.expectedScore);
  });
});

describe("normalizeText", () => {
  test("follows the five steps of the contract", () => {
    expect(normalizeText("  Ёлка, Größe & CAFÉ!  ")).toBe("елка große cafe");
    expect(normalizeText("one\n\ttwo")).toBe("one two");
    expect(normalizeText("...")).toBe("");
  });

  test("tokens of an empty text are an empty list", () => {
    expect(tokens("")).toEqual([]);
    expect(tokens("make a decision")).toEqual(["make", "a", "decision"]);
  });
});

describe("normalizeTerm", () => {
  test("returns the term with normalized text", () => {
    expect(normalizeTerm({ text: "Make a  Decision!", lang: "en", mode: "phrase" })).toEqual({
      text: "make a decision",
      lang: "en",
      mode: "phrase",
    });
  });

  test.each([
    [{ text: "!!!", lang: "en", mode: "substring" }, "empty"],
    [{ text: "ice cream", lang: "en", mode: "word" }, "has_space"],
    [{ text: "e-mail", lang: "en", mode: "word" }, "has_space"],
    [{ text: "dec", lang: "en", mode: "prefix" }, "prefix_too_short"],
    [{ text: "decision", lang: "en", mode: "phrase" }, "phrase_too_short"],
  ] as const)("refuses %o: %s", (term, problem) => {
    expect(() => normalizeTerm(term)).toThrow(MatchTermError);
    try {
      normalizeTerm(term);
    } catch (error) {
      expect((error as MatchTermError).problem).toBe(problem);
    }
  });

  test("termMatches refuses a broken term instead of matching everything", () => {
    expect(() => termMatches({ text: "...", lang: "en", mode: "substring" }, "any text")).toThrow(
      MatchTermError,
    );
  });
});

describe("itemKey and marker", () => {
  test("item keys follow the contract", async () => {
    expect(await itemKey("mistake", { patternKey: "grammar.articles.missing_or_wrong" })).toBe(
      "grammar.articles.missing_or_wrong",
    );
    expect(await itemKey("word", { term: "Make a Decision" })).toBe("word:make a decision");
  });

  test("an item without text after normalization has no key", async () => {
    await expect(itemKey("word", { term: "?!" })).rejects.toThrow();
  });

  test("a marker is 8 hex characters of SHA-256 of language:itemKey", async () => {
    // SHA-256("en:word:make a decision") starts with fd2dd8e3.
    expect(await marker("en", "word:make a decision")).toBe("fd2dd8e3");
  });

  test("the same language and item key give the same marker, another language a different one", async () => {
    const key = "vocabulary.false_friend.actual";
    expect(await marker("en", key)).toBe(await marker("en", key));
    expect(await marker("en", key)).not.toBe(await marker("de", key));
    expect(await marker("en", key)).toMatch(/^[0-9a-f]{8}$/);
  });
});

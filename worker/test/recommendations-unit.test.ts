import { AnalysisResult, type Finding, type WordSuggestion } from "shared";
import resultOk from "shared/fixtures/analysis/result-ok.json";
import { describe, expect, it } from "vitest";
import { type Knowledge, type RankedItem, rankItems } from "../src/recommendations/rank";
import { embedLine, MAX_EMBED_LINE, render } from "../src/recommendations/render";

const OK = AnalysisResult.parse(resultOk);
const [ARTICLES, TENSES, ACTUAL] = OK.findings as [Finding, Finding, Finding];
const [DECISION, CRUCIAL] = OK.words as [WordSuggestion, WordSuggestion];

function finding(key: string, severity: Finding["severity"]): Finding {
  return { ...ARTICLES, patternKey: key, category: key.split(".")[0] as Finding["category"], severity };
}

function knowledge(
  patterns: [string, Partial<{ status: "active" | "learned" | "dismissed"; transcriptsCount: number }>][],
  words: [string, "new" | "learning" | "known" | "dismissed"][],
): Knowledge {
  return {
    patterns: new Map(patterns.map(([k, p]) => [k, { status: "active", transcriptsCount: 1, ...p }])),
    words: new Map(words),
  };
}

describe("rankItems", () => {
  it("orders high, recurring, words, medium, low, keeping the model's order inside a group", async () => {
    const result = AnalysisResult.parse({
      ...OK,
      findings: [
        finding("grammar.a.low", "low"),
        finding("grammar.b.medium", "medium"),
        finding("grammar.c.recurring_low", "low"),
      ],
      words: [DECISION, CRUCIAL],
    });
    const ranked = await rankItems(
      result,
      knowledge(
        [
          ["grammar.a.low", {}],
          ["grammar.b.medium", {}],
          ["grammar.c.recurring_low", { transcriptsCount: 2 }],
        ],
        [
          ["word:make a decision", "new"],
          ["word:crucial", "learning"],
        ],
      ),
    );
    expect(ranked.map((r) => [r.itemKey, r.recurring, r.send])).toEqual([
      ["grammar.c.recurring_low", true, true],
      ["word:make a decision", false, true],
      ["word:crucial", false, true],
      ["grammar.b.medium", false, true],
      ["grammar.a.low", false, true],
    ]);

    const withHigh = AnalysisResult.parse({
      ...OK,
      findings: [finding("grammar.b.medium", "medium"), finding("grammar.d.high", "high")],
      words: [],
    });
    const second = await rankItems(
      withHigh,
      knowledge(
        [
          ["grammar.b.medium", { transcriptsCount: 3 }],
          ["grammar.d.high", {}],
        ],
        [],
      ),
    );
    expect(second.map((r) => r.itemKey)).toEqual(["grammar.d.high", "grammar.b.medium"]);
  });

  it("ranks dismissed patterns and known or dismissed words but does not send them", async () => {
    const ranked = await rankItems(
      OK,
      knowledge(
        [
          [ARTICLES.patternKey, { status: "dismissed" }],
          [TENSES.patternKey, { status: "learned" }],
          [ACTUAL.patternKey, {}],
        ],
        [
          ["word:make a decision", "known"],
          ["word:crucial", "dismissed"],
          ["word:people with disabilities", "learning"],
        ],
      ),
    );
    expect(ranked.map((r) => [r.itemKey, r.send])).toEqual([
      [ARTICLES.patternKey, false],
      [TENSES.patternKey, true],
      ["word:make a decision", false],
      ["word:crucial", false],
      ["word:people with disabilities", true],
      [ACTUAL.patternKey, true],
    ]);
  });

  it("throws when an item has no pattern or word", async () => {
    await expect(rankItems(OK, knowledge([], []))).rejects.toThrow(/no pattern/);
  });
});

function mistake(item: Finding, transcriptsCount = 1): RankedItem {
  return {
    kind: "mistake",
    itemKey: item.patternKey,
    item,
    recurring: transcriptsCount >= 2,
    transcriptsCount,
    send: true,
  };
}

function word(item: WordSuggestion): RankedItem {
  return {
    kind: "word",
    itemKey: `word:${item.term}`,
    item,
    recurring: false,
    transcriptsCount: null,
    send: true,
  };
}

describe("render", () => {
  it("renders a mistake: the correct form as title, every example, explanation and tip as notes", () => {
    expect(render(mistake(TENSES))).toEqual({
      title: "I saw it yesterday",
      notes: [
        "Say: I saw it yesterday",
        "Not: I have seen it yesterday",
        "",
        "Say: We released the beta of onboarding last week",
        "Not: We have released the beta of onboarding last week",
        "",
        TENSES.explanation,
        "",
        TENSES.tip,
      ].join("\n"),
      embedLine: 'MOZOL: I saw it yesterday (not "I have seen it yesterday")',
    });
  });

  it("adds the conversation count of a recurring mistake and leaves out a missing tip", () => {
    const rendered = render(mistake(ACTUAL, 3));
    expect(rendered.notes.split("\n\n").slice(-2)).toEqual([ACTUAL.explanation, "Seen in 3 conversations."]);
    expect(render(mistake(ACTUAL)).notes).not.toContain("Seen in");
  });

  it("renders a word with its translation, meaning, example and what the learner said", () => {
    expect(render(word(DECISION))).toEqual({
      title: "make a decision — принять решение",
      notes: [
        DECISION.meaning,
        "",
        DECISION.example,
        DECISION.exampleTranslation,
        "",
        "You said: do a decision",
      ].join("\n"),
      embedLine: "MOZOL: make a decision — принять решение",
    });
    expect(render(word({ ...DECISION, learnerSaid: null })).notes).not.toContain("You said");
  });

  it("keeps no trailing spaces and puts no line break into the title or the embed line", () => {
    const messy: Finding = {
      ...ACTUAL,
      examples: [{ quote: "the actual  \n version", correction: "the current\nversion  " }],
      explanation: "Первая строка.   \nВторая строка.  ",
      tip: "  ",
    };
    const rendered = render(mistake(messy));
    expect(rendered.title).toBe("the current version");
    expect(rendered.embedLine).toBe('MOZOL: the current version (not "the actual version")');
    expect(rendered.notes).toBe(
      "Say: the current\nversion\nNot: the actual\n version\n\nПервая строка.\nВторая строка.",
    );
    for (const line of rendered.notes.split("\n")) expect(line).toBe(line.trimEnd());
  });

  it("drops the wrong form, then cuts the correct form, when the embed line passes 200 characters", () => {
    const long = (n: number) => "x".repeat(n);
    const fits = render(mistake({ ...ACTUAL, examples: [{ quote: long(120), correction: long(80) }] }));
    expect(fits.embedLine).toBe(`MOZOL: ${long(80)}`);
    const cut = render(mistake({ ...ACTUAL, examples: [{ quote: "q", correction: long(300) }] }));
    expect(cut.embedLine).toHaveLength(MAX_EMBED_LINE);
    expect(cut.embedLine).toBe(`MOZOL: ${long(MAX_EMBED_LINE - 8)}…`);
    const term = render(word({ ...CRUCIAL, translation: long(250) }));
    expect(term.embedLine).toBe("MOZOL: crucial");
    expect(embedLine([`${"я".repeat(198)}😀😀`])).toHaveLength(MAX_EMBED_LINE);
  });
});

// The delivery order of an analysis (docs/product/reminders.md, "What goes to the phone").
import { type AnalysisResult, type Finding, itemKey, type WordSuggestion } from "shared";

export type PatternKnowledge = { status: "active" | "learned" | "dismissed"; transcriptsCount: number };
export type WordStatus = "new" | "learning" | "known" | "dismissed";

// What the user's patterns and words say about the items, by item key.
export type Knowledge = { patterns: Map<string, PatternKnowledge>; words: Map<string, WordStatus> };

export type RankedItem =
  | {
      kind: "mistake";
      itemKey: string;
      item: Finding;
      recurring: boolean;
      transcriptsCount: number;
      send: boolean;
    }
  | {
      kind: "word";
      itemKey: string;
      item: WordSuggestion;
      recurring: false;
      transcriptsCount: null;
      send: boolean;
    };

// Groups in delivery order; inside a group the model's order stays.
const GROUP = { high: 0, recurring: 1, word: 2, medium: 3, low: 4 } as const;

export async function rankItems(result: AnalysisResult, knowledge: Knowledge): Promise<RankedItem[]> {
  const mistakes = await Promise.all(
    result.findings.map(async (item): Promise<RankedItem> => {
      const key = await itemKey("mistake", item);
      const pattern = knowledge.patterns.get(key);
      if (pattern === undefined) throw new Error(`rankItems: no pattern for ${key}`);
      return {
        kind: "mistake",
        itemKey: key,
        item,
        recurring: pattern.transcriptsCount >= 2,
        transcriptsCount: pattern.transcriptsCount,
        send: pattern.status !== "dismissed",
      };
    }),
  );
  const words = await Promise.all(
    result.words.map(async (item): Promise<RankedItem> => {
      const key = await itemKey("word", item);
      const status = knowledge.words.get(key);
      if (status === undefined) throw new Error(`rankItems: no word for ${key}`);
      return {
        kind: "word",
        itemKey: key,
        item,
        recurring: false,
        transcriptsCount: null,
        send: status !== "known" && status !== "dismissed",
      };
    }),
  );
  const items = [...mistakes, ...words];
  // Array.prototype.sort is stable, so the model's order stays inside a group.
  return items.sort((a, b) => group(a) - group(b));
}

function group(ranked: RankedItem): number {
  if (ranked.kind === "word") return GROUP.word;
  if (ranked.item.severity === "high") return GROUP.high;
  if (ranked.recurring) return GROUP.recurring;
  return GROUP[ranked.item.severity];
}

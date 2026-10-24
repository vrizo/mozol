// The texts a recommendation carries to the phone: title and notes of a new MOZOL reminder, the line for a
// reminder of the user, and the priority (docs/product/reminders.md). Fixed wording comes from copy.ts.
import { copy } from "../copy";
import type { RankedItem } from "./rank";

export const MAX_EMBED_LINE = 200;
const ELLIPSIS = "…";

export type Rendered = { title: string; notes: string; embedLine: string; priority: 1 | 5 };

const t = copy.reminders;

export function render(ranked: RankedItem): Rendered {
  return ranked.kind === "mistake" ? renderMistake(ranked) : renderWord(ranked);
}

function renderMistake(ranked: Extract<RankedItem, { kind: "mistake" }>): Rendered {
  const { item } = ranked;
  const [first] = item.examples;
  if (first === undefined) throw new Error("render: a finding without examples");
  const examples = item.examples.map((e) => `${t.sayLabel} ${e.correction}\n${t.notLabel} ${e.quote}`);
  const notes = [
    ...examples,
    item.explanation,
    item.tip,
    ranked.recurring ? t.seenIn(ranked.transcriptsCount) : null,
  ];
  return {
    title: oneLine(first.correction),
    notes: paragraphs(notes),
    embedLine: embedLine([
      `${oneLine(first.correction)} ${t.embedWrong(oneLine(first.quote))}`,
      oneLine(first.correction),
    ]),
    priority: item.severity === "high" || ranked.recurring ? 1 : 5,
  };
}

function renderWord(ranked: Extract<RankedItem, { kind: "word" }>): Rendered {
  const { item } = ranked;
  const term = oneLine(item.term);
  const title = t.termWithTranslation(term, oneLine(item.translation));
  const notes = [
    item.meaning,
    `${item.example}\n${item.exampleTranslation}`,
    item.learnerSaid === null ? null : `${t.youSaidLabel} ${item.learnerSaid}`,
  ];
  return { title, notes: paragraphs(notes), embedLine: embedLine([title, term]), priority: 5 };
}

// "<prefix> <text>" with the first text that fits in MAX_EMBED_LINE. The texts go from full to short, each one
// without an optional part of the one before:
// - mistake: the correct form with the wrong form, then the correct form alone;
// - word: the term with its translation, then the term alone.
// When even the shortest one is too long, it is cut and ends with "…".
export function embedLine(texts: string[]): string {
  const lines = texts.map((text) => `${t.embedPrefix} ${text}`);
  const fits = lines.find((line) => line.length <= MAX_EMBED_LINE);
  if (fits !== undefined) return fits;
  const shortest = lines.at(-1);
  if (shortest === undefined) throw new Error("embedLine: no texts");
  return cut(shortest, MAX_EMBED_LINE);
}

// Paragraphs split by an empty line; empty parts are left out, and no line ends with spaces.
function paragraphs(parts: (string | null)[]): string {
  return parts
    .filter((part): part is string => part !== null && part.trim() !== "")
    .map((part) =>
      part
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim(),
    )
    .join("\n\n");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Cuts at a code point boundary so the result with "…" has at most max UTF-16 units.
function cut(text: string, max: number): string {
  let out = "";
  for (const char of text) {
    if (out.length + char.length + ELLIPSIS.length > max) break;
    out += char;
  }
  return out.trimEnd() + ELLIPSIS;
}

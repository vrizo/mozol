import type { Finding } from "shared";
import { describe, expect, it } from "vitest";
import { anyBusy, formatDuration, groupFindings } from "./transcripts";

const finding = (patternKey: string, severity: Finding["severity"]): Finding => ({
  patternKey,
  category: patternKey.split(".")[0] as Finding["category"],
  title: patternKey,
  severity,
  occurrences: 1,
  examples: [{ quote: "a", correction: "b" }],
  explanation: "x",
  tip: null,
  matchTerms: [],
});

describe("groupFindings", () => {
  it("groups by category with high severity first", () => {
    const groups = groupFindings([
      finding("grammar.a.low", "low"),
      finding("vocabulary.b.medium", "medium"),
      finding("grammar.c.high", "high"),
      finding("register.d.high", "high"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["grammar", "register", "vocabulary"]);
    expect(groups[0]?.findings.map((f) => f.patternKey)).toEqual(["grammar.c.high", "grammar.a.low"]);
  });

  it("keeps result order for the same severity", () => {
    const groups = groupFindings([finding("grammar.a.x", "medium"), finding("grammar.b.x", "medium")]);
    expect(groups[0]?.findings.map((f) => f.patternKey)).toEqual(["grammar.a.x", "grammar.b.x"]);
  });
});

describe("anyBusy", () => {
  it("is true while a transcript is queued or analyzing", () => {
    expect(anyBusy([{ status: "analyzed" }, { status: "queued" }])).toBe(true);
    expect(anyBusy([{ status: "analyzing" }])).toBe(true);
    expect(anyBusy([{ status: "analyzed" }, { status: "needs_speaker" }, { status: "failed" }])).toBe(false);
    expect(anyBusy([])).toBe(false);
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(720)).toBe("12 min");
    expect(formatDuration(3900)).toBe("1 h 05 min");
  });
});

// The user message of an analysis request: the learner, the known patterns and the numbered transcript
// (docs/backend/ai-analysis.md, "Prompt" and "Size").
import type { Level, MatchTerm, PatternStatus, SourceKind, User } from "shared";
import { countWords } from "../sources/learner";
import type { Segment } from "../sources/types";
import { AnalysisError } from "./errors";

// Characters are counted as JavaScript string length, like the paste limit (shared/src/transcripts.ts).
export const MAX_TRANSCRIPT_CHARS = 400_000;
export const MAX_KNOWN_PATTERNS = 50;

export type KnownPattern = {
  language: string;
  key: string;
  title: string;
  matchTerms: MatchTerm[];
  status: PatternStatus;
  lastSeenAt: string;
};

// The estimated level of one earlier analysis of the user.
export type EarlierLevel = { language: string | null; estimatedLevel: Level | null; createdAt: string };

export type ModelInputParams = {
  transcript: { kind: SourceKind; segments: Segment[]; learnerSpeakerId: string };
  user: Pick<User, "nativeLanguage">;
  knownPatterns: KnownPattern[];
  levels: EarlierLevel[];
};

export type ModelInput = {
  userMessage: string;
  learnerWordCount: number;
  // The learner's turns as they are, for the quote check.
  learnerLines: string[];
  // Only the learner's lines and the line before each were sent.
  compressed: boolean;
};

const COMPRESSED_NOTE =
  "Note: the transcript is too long to show in full. It shows only the learner's lines and the line before each; the numbers are the line numbers of the full transcript.";

export function buildModelInput({ transcript, user, knownPatterns, levels }: ModelInputParams): ModelInput {
  const { segments, learnerSpeakerId } = transcript;
  const learnerSegments = segments.filter((s) => s.speakerId === learnerSpeakerId);
  const learner = learnerSegments[0];
  if (learner === undefined) throw new Error(`buildModelInput: speaker ${learnerSpeakerId} has no turns`);

  const lines = segments.map((s, i) => {
    const mark = s.speakerId === learnerSpeakerId ? "*" : "";
    return `[${i + 1}${mark}] ${s.speakerName}: ${s.text}`;
  });
  let shown = lines;
  let compressed = false;
  if (lines.join("\n").length > MAX_TRANSCRIPT_CHARS) {
    compressed = true;
    shown = lines.filter(
      (_, i) =>
        segments[i]?.speakerId === learnerSpeakerId || segments[i + 1]?.speakerId === learnerSpeakerId,
    );
    const size = shown.join("\n").length;
    if (size > MAX_TRANSCRIPT_CHARS) {
      throw new AnalysisError("transcript_too_long", false, `${size} characters of learner turns`);
    }
  }

  const userMessage = [
    "Learner",
    `- Native language: ${languageLabel(user.nativeLanguage)}`,
    `- Latest estimated level: ${levelsLine(levels)}`,
    "",
    `Source kind: ${transcript.kind}`,
    `Learner speaker: ${learner.speakerName}`,
    "",
    "Known patterns (language | key | title | match terms)",
    ...patternLines(knownPatterns),
    "",
    "Transcript",
    ...(compressed ? [COMPRESSED_NOTE] : []),
    ...shown,
  ].join("\n");

  return {
    userMessage,
    learnerWordCount: learnerSegments.reduce((sum, s) => sum + countWords(s.text), 0),
    learnerLines: learnerSegments.map((s) => s.text),
    compressed,
  };
}

// Up to 50 active patterns, the most recently seen first.
function patternLines(patterns: KnownPattern[]): string[] {
  const active = patterns
    .filter((p) => p.status === "active")
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || a.key.localeCompare(b.key))
    .slice(0, MAX_KNOWN_PATTERNS);
  if (active.length === 0) return ["none"];
  return active.map((p) => {
    const terms = p.matchTerms.length === 0 ? "(none)" : p.matchTerms.map((t) => t.text).join(", ");
    return `${p.language} | ${p.key} | ${p.title} | ${terms}`;
  });
}

// The newest estimated level per language, languages in alphabetical order.
function levelsLine(levels: EarlierLevel[]): string {
  const newest = new Map<string, { level: Level; createdAt: string }>();
  for (const { language, estimatedLevel, createdAt } of levels) {
    if (language === null || estimatedLevel === null) continue;
    const known = newest.get(language);
    if (known === undefined || createdAt > known.createdAt) {
      newest.set(language, { level: estimatedLevel, createdAt });
    }
  }
  if (newest.size === 0) return "none";
  return [...newest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, { level }]) => `${languageLabel(language)} ${level}`)
    .join("; ");
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export function languageLabel(code: string): string {
  return `${languageNames.of(code) ?? code} (${code})`;
}

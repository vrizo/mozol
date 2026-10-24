// The user message of an analysis request: the learner, the known patterns and the learner's own lines
// (docs/backend/ai-analysis.md, "Prompt" and "Size"). The other speakers' lines never reach the model.
import type { MatchTerm, PatternStatus, SourceKind, User } from "shared";
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

export type ModelInputParams = {
  transcript: { kind: SourceKind; segments: Segment[]; learnerSpeakerId: string };
  user: Pick<User, "nativeLanguage">;
  knownPatterns: KnownPattern[];
};

export type ModelInput = {
  kind: SourceKind;
  userMessage: string;
  learnerWordCount: number;
  // The learner's turns as they are, for the quote check.
  learnerLines: string[];
};

export function buildModelInput({ transcript, user, knownPatterns }: ModelInputParams): ModelInput {
  const { segments, learnerSpeakerId } = transcript;
  const learnerLines = segments.filter((s) => s.speakerId === learnerSpeakerId).map((s) => s.text);
  if (learnerLines.length === 0) throw new Error(`buildModelInput: speaker ${learnerSpeakerId} has no turns`);

  const lines = learnerLines.map((text, i) => `[${i + 1}] ${text}`);
  const size = lines.join("\n").length;
  if (size > MAX_TRANSCRIPT_CHARS) {
    throw new AnalysisError("transcript_too_long", false, `${size} characters of learner lines`);
  }

  const userMessage = [
    "Learner",
    `- Native language: ${languageLabel(user.nativeLanguage)}`,
    "",
    `Source kind: ${transcript.kind}`,
    "",
    "Known patterns (language | key | title | match terms)",
    ...patternLines(knownPatterns),
    "",
    "The learner's lines",
    ...lines,
  ].join("\n");

  return {
    kind: transcript.kind,
    userMessage,
    learnerWordCount: learnerLines.reduce((sum, text) => sum + countWords(text), 0),
    learnerLines,
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

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export function languageLabel(code: string): string {
  return `${languageNames.of(code) ?? code} (${code})`;
}

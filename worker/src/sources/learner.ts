// Finds the user's own speaker in a transcript (docs/product/sources.md, "Finding the user's turns").
import { normalizeText, tokens, type User } from "shared";
import type { NormalizedTranscript, Segment, SourceAdapter } from "./types";

export type Learner = { speakerId: string; wordCount: number };

export type Speaker = { id: string; name: string; wordCount: number; firstLines: string[] };

// The rules in order: the speaker the source names as the user, the account email, a speaker name, the only
// speaker. The first rule that finds exactly one speaker decides; a rule that finds several gives null.
export function findLearner(
  transcript: Pick<NormalizedTranscript, "participants" | "segments" | "learnerSpeakerHint">,
  user: Pick<User, "email" | "speakerNames">,
  adapter: Pick<SourceAdapter, "isPlaceholderName">,
): Learner | null {
  const speakers = speakersOf(transcript.segments);
  const email = user.email.toLowerCase();
  const rules: (() => string[])[] = [
    () => (transcript.learnerSpeakerHint === null ? [] : [transcript.learnerSpeakerHint]),
    () => transcript.participants.filter((p) => p.isRecorder).map((p) => p.id),
    () => transcript.participants.filter((p) => p.email?.trim().toLowerCase() === email).map((p) => p.id),
    () =>
      speakers
        .filter((s) => !adapter.isPlaceholderName(s.name))
        .filter((s) => user.speakerNames.some((saved) => nameMatches(saved, s.name)))
        .map((s) => s.id),
    () => (speakers.length === 1 ? speakers.map((s) => s.id) : []),
  ];

  for (const rule of rules) {
    const found = new Set(rule().filter((id) => speakers.some((s) => s.id === id)));
    if (found.size > 1) return null;
    const speaker = speakers.find((s) => found.has(s.id));
    if (speaker !== undefined) return { speakerId: speaker.id, wordCount: speaker.wordCount };
  }
  return null;
}

// Case, accents and extra spaces do not count; a saved name also matches the first word of a longer name.
export function nameMatches(saved: string, speakerName: string): boolean {
  const savedKey = nameKey(saved);
  const speakerKey = nameKey(speakerName);
  if (savedKey === "") return false;
  return savedKey === speakerKey || speakerKey.split(" ")[0] === savedKey;
}

export function nameKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  return tokens(normalizeText(text)).length;
}

// Every speaker with turns, in order of the first turn, named as in that turn.
export function speakersOf(segments: Segment[]): Speaker[] {
  const speakers = new Map<string, Speaker>();
  for (const segment of segments) {
    let speaker = speakers.get(segment.speakerId);
    if (speaker === undefined) {
      speaker = { id: segment.speakerId, name: segment.speakerName, wordCount: 0, firstLines: [] };
      speakers.set(segment.speakerId, speaker);
    }
    speaker.wordCount += countWords(segment.text);
    if (speaker.firstLines.length < 3) speaker.firstLines.push(segment.text);
  }
  return [...speakers.values()];
}

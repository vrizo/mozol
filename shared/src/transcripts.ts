// Transcripts, their analysis, and the paste endpoint.
import { z } from "zod";
import { AnalysisResult } from "./analysis";
import { Id, LanguageCode, paged, SourceId, SourceKind, Time } from "./common";
import { Recommendation } from "./recommendations";

export const TranscriptStatus = z.enum(["received", "queued", "analyzing", "analyzed", "skipped", "failed"]);
export type TranscriptStatus = z.infer<typeof TranscriptStatus>;

export const TranscriptErrorCode = z.enum([
  "analysis_failed",
  "analysis_refused",
  "analysis_truncated",
  "analysis_invalid",
  "transcript_too_long",
  "internal",
]);
export type TranscriptErrorCode = z.infer<typeof TranscriptErrorCode>;

export const SkipReason = z.enum(["too_short", "too_little_speech", "native_language"]);
export type SkipReason = z.infer<typeof SkipReason>;

const Count = z.number().int().min(0);

export const Transcript = z.strictObject({
  id: Id,
  source: SourceId,
  connectionId: Id.nullable(),
  kind: SourceKind,
  title: z.string().nullable(),
  occurredAt: Time,
  durationSec: z.number().int().min(0).nullable(),
  language: LanguageCode.nullable(),
  status: TranscriptStatus,
  skipReason: SkipReason.nullable(),
  errorCode: TranscriptErrorCode.nullable(),
  learnerSpeakerName: z.string().nullable(),
  counts: z.strictObject({ findings: Count, words: Count }).nullable(),
  createdAt: Time,
});
export type Transcript = z.infer<typeof Transcript>;

export const Analysis = z.strictObject({
  id: Id,
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  createdAt: Time,
  result: AnalysisResult,
});
export type Analysis = z.infer<typeof Analysis>;

export const TranscriptDetail = Transcript.extend({
  segments: z.array(
    z.strictObject({ speakerId: z.string().min(1), speakerName: z.string(), text: z.string() }),
  ),
  analysis: Analysis.nullable(),
  // In delivery order.
  recommendations: z.array(Recommendation),
});
export type TranscriptDetail = z.infer<typeof TranscriptDetail>;

export const TranscriptResponse = z.strictObject({ transcript: Transcript });
export type TranscriptResponse = z.infer<typeof TranscriptResponse>;

export const TranscriptDetailResponse = z.strictObject({ transcript: TranscriptDetail });
export type TranscriptDetailResponse = z.infer<typeof TranscriptDetailResponse>;

export const TranscriptsPage = paged(Transcript);
export type TranscriptsPage = z.infer<typeof TranscriptsPage>;

// The paste source; the text format is in docs/product/sources.md.
export const PasteTranscriptBody = z.strictObject({
  title: z.string().min(1).max(300).optional(),
  occurredAt: Time.optional(),
  text: z.string().min(1).max(400_000),
});
export type PasteTranscriptBody = z.infer<typeof PasteTranscriptBody>;

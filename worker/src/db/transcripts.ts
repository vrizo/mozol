// The transcripts table and its mapping to the API Transcript (shared/CONTRACT.md). participants and segments are
// stored in snake_case and read only where they are needed: segments can take 1,500,000 bytes.
import { Transcript } from "shared";
import { z } from "zod";
import type { Participant, Segment } from "../sources/types";
import { readJson, writeJson } from "./json";

export const MAX_SEGMENTS_BYTES = 1_500_000;

export type TranscriptRow = {
  id: string;
  source: string;
  connection_id: string | null;
  kind: string;
  title: string | null;
  occurred_at: string;
  duration_sec: number | null;
  language: string | null;
  status: string;
  skip_reason: string | null;
  error_code: string | null;
  learner_speaker_name: string | null;
  created_at: string;
};

// The columns of TranscriptRow from "transcripts t"; the learner's name is the name of their first turn.
export const TRANSCRIPT_COLUMNS = `t.id, t.source, t.connection_id, t.kind, t.title, t.occurred_at, t.duration_sec,
  t.language, t.status, t.skip_reason, t.error_code, t.created_at,
  (SELECT json_extract(s.value, '$.speaker_name') FROM json_each(t.segments) s
   WHERE json_extract(s.value, '$.speaker_id') = t.learner_speaker_id LIMIT 1) AS learner_speaker_name`;

const SegmentsColumn = z.array(
  z.strictObject({
    speaker_id: z.string(),
    speaker_name: z.string(),
    text: z.string(),
    start_sec: z.number().nullable(),
  }),
);

// counts stay null until the analysis stores its results (step B08).
export function transcriptFromRow(row: TranscriptRow): Transcript {
  return Transcript.parse({
    id: row.id,
    source: row.source,
    connectionId: row.connection_id,
    kind: row.kind,
    title: row.title,
    occurredAt: row.occurred_at,
    durationSec: row.duration_sec,
    language: row.language,
    status: row.status,
    skipReason: row.skip_reason,
    errorCode: row.error_code,
    learnerSpeakerName: row.learner_speaker_name,
    counts: null,
    createdAt: row.created_at,
  });
}

export async function findTranscript(
  db: D1Database,
  userId: string,
  id: string,
): Promise<TranscriptRow | null> {
  return db
    .prepare(`SELECT ${TRANSCRIPT_COLUMNS} FROM transcripts t WHERE t.id = ? AND t.user_id = ?`)
    .bind(id, userId)
    .first<TranscriptRow>();
}

export function participantsColumn(participants: Participant[]): string {
  return writeJson(
    participants.map((p) => ({ id: p.id, name: p.name, email: p.email, is_recorder: p.isRecorder })),
  );
}

// Sources send no times per segment, so start_sec is null.
export function segmentsColumn(segments: Segment[]): string {
  return writeJson(
    segments.map((s) => ({
      speaker_id: s.speakerId,
      speaker_name: s.speakerName,
      text: s.text,
      start_sec: null,
    })),
  );
}

export function readSegments(text: string): Segment[] {
  return readJson(text, SegmentsColumn, "transcripts.segments").map((s) => ({
    speakerId: s.speaker_id,
    speakerName: s.speaker_name,
    text: s.text,
  }));
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

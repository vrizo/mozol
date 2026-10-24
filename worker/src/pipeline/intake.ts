// Stores a normalized transcript, finds the user's speaker and starts the analysis (docs/backend/pipeline.md,
// "Intake", steps 5 to 8). The webhook route and the paste route both end here. A transcript never waits for the
// user: when no rule finds the learner, learner_speaker_id stays null and the workflow's speaker step chooses.
import type { User } from "shared";
import { byteLength, MAX_SEGMENTS_BYTES, participantsColumn, segmentsColumn } from "../db/transcripts";
import type { Env } from "../env";
import { newId } from "../ids";
import { log } from "../log";
import { findLearner } from "../sources/learner";
import type { NormalizedTranscript, SourceAdapter } from "../sources/types";
import { nowIso } from "../time";
import { startAnalysis } from "./start";

export type StoreInput = {
  user: User;
  connectionId: string | null;
  adapter: SourceAdapter;
  transcript: NormalizedTranscript;
};

// too_large: the segments take more than 1,500,000 bytes as JSON. duplicate: the connection sent this external id
// before; transcriptId is the stored one.
export type StoreResult =
  | { outcome: "too_large" }
  | { outcome: "accepted" | "duplicate"; transcriptId: string };

export async function storeTranscript(env: Env, rid: string, input: StoreInput): Promise<StoreResult> {
  const { transcript, adapter } = input;
  const segments = segmentsColumn(transcript.segments);
  if (byteLength(segments) > MAX_SEGMENTS_BYTES) return { outcome: "too_large" };

  const learner = findLearner(transcript, input.user, adapter);
  const id = newId("trn");
  const now = nowIso();
  const inserted = await env.DB.prepare(
    `INSERT INTO transcripts
       (id, user_id, connection_id, source, external_id, kind, title, occurred_at, duration_sec, language,
        participants, segments, learner_speaker_id, learner_word_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (connection_id, external_id) DO NOTHING
     RETURNING id`,
  )
    .bind(
      id,
      input.user.id,
      input.connectionId,
      adapter.id,
      transcript.externalId,
      transcript.kind,
      transcript.title,
      transcript.occurredAt,
      transcript.durationSec,
      transcript.language,
      participantsColumn(transcript.participants),
      segments,
      learner?.speakerId ?? null,
      learner?.wordCount ?? null,
      "received",
      now,
      now,
    )
    .first<{ id: string }>();

  if (inserted === null) {
    const existing = await env.DB.prepare(
      "SELECT id FROM transcripts WHERE connection_id = ? AND external_id = ?",
    )
      .bind(input.connectionId, transcript.externalId)
      .first<{ id: string }>();
    if (existing === null) throw new Error("storeTranscript: a conflict without a stored transcript");
    return { outcome: "duplicate", transcriptId: existing.id };
  }

  log(rid, "transcript_stored", {
    transcript: id,
    source: adapter.id,
    segments: transcript.segments.length,
    learnerFound: learner !== null,
    learnerWords: learner?.wordCount ?? null,
  });
  await startAnalysis(env, id, rid);
  return { outcome: "accepted", transcriptId: id };
}

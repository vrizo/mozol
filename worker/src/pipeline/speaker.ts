// The speaker step: makes sure the transcript has a learner before the analysis (docs/backend/pipeline.md,
// "Workflow", step 1). It never fails the transcript: without a valid model answer it picks a speaker at random.
import { AnalysisError } from "../analysis/errors";
import {
  createSpeakerPicker,
  SpeakerAnswerError,
  type SpeakerPicker,
  speakerQuestion,
} from "../analysis/speaker";
import { readSegments } from "../db/transcripts";
import { type UserRow, userFromRow } from "../db/users";
import type { Env } from "../env";
import { log, logError } from "../log";
import { nowIso } from "../time";

export type SpeakerOutcome = "stale" | "kept" | "model" | "random";

export type ChooseOptions = {
  rid: string;
  // The step's last attempt: a retryable model error picks at random instead of being thrown for a retry.
  final: boolean;
  // undefined: the picker of the analysis mode (null in fixture mode).
  picker?: SpeakerPicker | null;
  random?: () => number;
};

type Row = { run: number; learner_speaker_id: string | null; segments: string } & UserRow;

export async function chooseLearner(
  env: Env,
  transcriptId: string,
  run: number,
  options: ChooseOptions,
): Promise<SpeakerOutcome> {
  const row = await env.DB.prepare(
    `SELECT t.run, t.learner_speaker_id, t.segments, u.*
     FROM transcripts t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
  )
    .bind(transcriptId)
    .first<Row>();
  if (row === null || row.run !== run) return "stale";
  if (row.learner_speaker_id !== null) return "kept";

  const user = userFromRow(row);
  const question = speakerQuestion(readSegments(row.segments), user);
  const picker = options.picker === undefined ? createSpeakerPicker(env) : options.picker;

  let speakerId: string | null = null;
  let reason = "fixture";
  if (picker !== null) {
    try {
      speakerId = await picker.pick(question);
    } catch (error) {
      if (error instanceof AnalysisError && error.retryable && !options.final) throw error;
      reason = randomReason(error);
      if (reason === "internal") {
        logError(options.rid, "learner_pick_failed", {
          transcript: transcriptId,
          run,
          error: error instanceof Error ? error.name : typeof error,
        });
      }
    }
  }
  const how = speakerId === null ? "random" : "model";
  if (speakerId === null) {
    const index = Math.floor((options.random ?? Math.random)() * question.speakers.length);
    speakerId = question.speakers[Math.min(index, question.speakers.length - 1)]?.id ?? null;
  }
  const speaker = question.speakers.find((s) => s.id === speakerId);
  if (speaker === undefined) throw new Error(`chooseLearner: transcript ${transcriptId} has no speakers`);

  const updated = await env.DB.prepare(
    `UPDATE transcripts SET learner_speaker_id = ?, learner_word_count = ?, updated_at = ?
     WHERE id = ? AND run = ? AND learner_speaker_id IS NULL`,
  )
    .bind(speaker.id, speaker.wordCount, nowIso(), transcriptId, run)
    .run();
  if (updated.meta.changes === 0) return "stale";

  // Paste and json sources use speaker names as ids, so logs name the speaker by its place in the transcript.
  const speakerIndex = question.speakers.indexOf(speaker) + 1;
  if (how === "random") {
    log(options.rid, "learner_random", { transcript: transcriptId, run, speakerIndex, reason });
  } else {
    log(options.rid, "learner_chosen", { transcript: transcriptId, run, speakerIndex, how });
  }
  return how;
}

function randomReason(error: unknown): string {
  if (error instanceof AnalysisError) return error.code;
  if (error instanceof SpeakerAnswerError) return `answer_${error.reason}`;
  return "internal";
}

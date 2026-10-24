// The prepare step: skips a transcript where the learner said too little, otherwise marks it analyzing
// (docs/backend/pipeline.md, "Workflow", step 2).
import type { Env } from "../env";
import { nowIso } from "../time";
import { clearResults } from "./store";

export const MIN_LEARNER_WORDS = 30;

export type PrepareOutcome = "stale" | "skipped" | "ready";

export async function prepareRun(env: Env, transcriptId: string, run: number): Promise<PrepareOutcome> {
  const row = await env.DB.prepare("SELECT run, learner_word_count FROM transcripts WHERE id = ?")
    .bind(transcriptId)
    .first<{ run: number; learner_word_count: number | null }>();
  if (row === null || row.run !== run) return "stale";
  if (row.learner_word_count === null) {
    throw new Error(`prepareRun: transcript ${transcriptId} has no learner after the speaker step`);
  }

  if (row.learner_word_count < MIN_LEARNER_WORDS) {
    await clearResults(env, transcriptId);
    await env.DB.prepare(
      `UPDATE transcripts SET status = 'skipped', skip_reason = 'too_short', error_code = NULL, updated_at = ?
       WHERE id = ? AND run = ?`,
    )
      .bind(nowIso(), transcriptId, run)
      .run();
    return "skipped";
  }
  const updated = await env.DB.prepare(
    "UPDATE transcripts SET status = 'analyzing', updated_at = ? WHERE id = ? AND run = ?",
  )
    .bind(nowIso(), transcriptId, run)
    .run();
  return updated.meta.changes === 0 ? "stale" : "ready";
}

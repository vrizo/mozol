// Starts an analysis run of a transcript (docs/backend/pipeline.md, "Intake").
import type { Env } from "../env";
import { log, logError } from "../log";
import { nowIso } from "../time";

export type StartResult = { run: number; started: boolean };

// Raises run by one, sets status queued and creates the workflow instance "<transcript id>-<run>". When creating
// the instance throws, the transcript becomes failed with error code internal; the caller still answers normally.
export async function startAnalysis(env: Env, transcriptId: string, rid: string): Promise<StartResult> {
  const queued = await env.DB.prepare(
    `UPDATE transcripts SET run = run + 1, status = 'queued', skip_reason = NULL, error_code = NULL, updated_at = ?
     WHERE id = ? RETURNING run`,
  )
    .bind(nowIso(), transcriptId)
    .first<{ run: number }>();
  if (queued === null) throw new Error(`startAnalysis: transcript ${transcriptId} does not exist`);
  const { run } = queued;

  try {
    await env.ANALYZE.create({ id: `${transcriptId}-${run}`, params: { transcriptId, run } });
  } catch (err) {
    await env.DB.prepare(
      `UPDATE transcripts SET status = 'failed', error_code = 'internal', updated_at = ?
       WHERE id = ? AND run = ?`,
    )
      .bind(nowIso(), transcriptId, run)
      .run();
    logError(rid, "analysis_start_failed", {
      transcript: transcriptId,
      run,
      code: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
    return { run, started: false };
  }
  log(rid, "analysis_started", { transcript: transcriptId, run });
  return { run, started: true };
}

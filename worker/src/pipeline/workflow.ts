// AnalyzeTranscript: the workflow that analyzes one transcript run (docs/backend/pipeline.md, "Workflow").
// learner_speaker_id may be null at the start; the first step (speaker) sets it before the analysis.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { TranscriptErrorCode } from "shared";
import { AnalysisError } from "../analysis/errors";
import type { Env } from "../env";
import { log, logError } from "../log";
import { notifyUser } from "../push/notify";
import { recommend } from "../recommendations/apply";
import { nowIso } from "../time";
import { runAnalysis } from "./analyze";
import { prepareRun } from "./prepare";
import { chooseLearner } from "./speaker";
import { storeResult } from "./store";

export type AnalyzeParams = { transcriptId: string; run: number };

const SPEAKER_RETRIES = 2;
const NOTIFY_RETRIES = 3;

export class AnalyzeTranscript extends WorkflowEntrypoint<Env, AnalyzeParams> {
  async run(event: WorkflowEvent<AnalyzeParams>, step: WorkflowStep): Promise<void> {
    const { transcriptId, run } = event.payload;
    // Workflow logs carry the instance id ("<transcript id>-<run>") as their rid.
    const rid = event.instanceId;
    const logged = <T>(name: string, fn: () => Promise<T>, outcome: (value: T) => string) =>
      timed(rid, { transcriptId, run, step: name }, fn, outcome);

    try {
      const speaker = await step.do(
        "speaker",
        { retries: { limit: SPEAKER_RETRIES, delay: "10 seconds" } },
        (ctx) =>
          logged(
            "speaker",
            () => chooseLearner(this.env, transcriptId, run, { rid, final: ctx.attempt > SPEAKER_RETRIES }),
            (o) => o,
          ),
      );
      if (speaker === "stale") return;

      const prepared = await step.do("prepare", () =>
        logged(
          "prepare",
          () => prepareRun(this.env, transcriptId, run),
          (o) => o,
        ),
      );
      if (prepared !== "ready") return;

      const analysis = await step.do(
        "analyze",
        { retries: { limit: 4, delay: "30 seconds", backoff: "exponential" }, timeout: "10 minutes" },
        () =>
          logged(
            "analyze",
            async () => {
              try {
                return await runAnalysis(this.env, transcriptId, run, { rid });
              } catch (error) {
                throw stepError(error);
              }
            },
            (o) => (o.outcome === "stale" ? "stale" : o.status),
          ),
      );
      if (analysis.outcome === "stale") return;

      const stored = await step.do("store", () =>
        logged(
          "store",
          () => storeResult(this.env, transcriptId, run),
          (o) => `${o.outcome}:${o.statements}`,
        ),
      );
      if (stored.outcome !== "stored") return;

      const recommended = await step.do("recommend", { retries: { limit: 3, delay: "5 seconds" } }, () =>
        logged(
          "recommend",
          () => recommend(this.env, transcriptId, run),
          (o) =>
            o.outcome === "stale"
              ? "stale"
              : `recommendations:${o.recommendations}:deliveries:${o.deliveries}`,
        ),
      );
      if (recommended.outcome === "stale" || recommended.deliveries === 0) return;
      await notifyStep(this.env, step, rid, { transcriptId, run }, recommended.userId, recommended.pending);
    } catch (error) {
      const code = errorCode(error);
      await step.do("fail", () =>
        logged(
          "fail",
          () => failTranscript(this.env, transcriptId, run, code),
          (o) => o,
        ),
      );
      throw error;
    }
  }
}

// A push that still fails after its retries is logged; the transcript stays analyzed and the app claims the
// deliveries on its next launch.
async function notifyStep(
  env: Env,
  step: WorkflowStep,
  rid: string,
  where: { transcriptId: string; run: number },
  userId: string,
  pending: number,
): Promise<void> {
  try {
    await step.do("notify", { retries: { limit: NOTIFY_RETRIES, delay: "1 minute" } }, () =>
      timed(
        rid,
        { ...where, step: "notify" },
        () => notifyUser(env, userId, { pending }, { rid }),
        (o) => `sent:${o.sent}:skipped:${o.skipped}:failed:${o.failed}`,
      ),
    );
  } catch (error) {
    logError(rid, "notify_gave_up", {
      transcript: where.transcriptId,
      run: where.run,
      error: error instanceof Error ? error.name : typeof error,
    });
  }
}

// An analysis error that must not be retried ends the step at once; the message keeps its code.
export function stepError(error: unknown): unknown {
  if (error instanceof AnalysisError && !error.retryable) return new NonRetryableError(error.message);
  return error;
}

// The transcript error code at the start of an error message ("analysis_refused: ..."), else internal. Across a
// step boundary a NonRetryableError message arrives as "NonRetryableError: analysis_refused: ...".
export function errorCode(error: unknown): TranscriptErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  const parsed = TranscriptErrorCode.safeParse(/^(?:[A-Za-z]+Error: )?([a-z_]+):/.exec(message)?.[1]);
  return parsed.success ? parsed.data : "internal";
}

// Sets the transcript to failed, unless a newer run took over.
export async function failTranscript(
  env: Env,
  transcriptId: string,
  run: number,
  code: TranscriptErrorCode,
): Promise<"failed" | "stale"> {
  const updated = await env.DB.prepare(
    `UPDATE transcripts SET status = 'failed', error_code = ?, skip_reason = NULL, updated_at = ?
     WHERE id = ? AND run = ?`,
  )
    .bind(code, nowIso(), transcriptId, run)
    .run();
  return updated.meta.changes === 0 ? "stale" : "failed";
}

// Runs one step attempt and logs its end with the duration and the outcome, or the error code.
async function timed<T>(
  rid: string,
  where: { transcriptId: string; run: number; step: string },
  fn: () => Promise<T>,
  outcome: (value: T) => string,
): Promise<T> {
  const started = Date.now();
  const fields = { transcript: where.transcriptId, run: where.run, step: where.step };
  try {
    const value = await fn();
    log(rid, "pipeline_step", { ...fields, durationMs: Date.now() - started, outcome: outcome(value) });
    return value;
  } catch (error) {
    logError(rid, "pipeline_step_failed", {
      ...fields,
      durationMs: Date.now() - started,
      code: errorCode(error),
      error: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

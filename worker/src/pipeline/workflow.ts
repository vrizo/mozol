// AnalyzeTranscript: the workflow that analyzes one transcript run (docs/backend/pipeline.md, "Workflow").
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "../env";

export type AnalyzeParams = { transcriptId: string; run: number };

export class AnalyzeTranscript extends WorkflowEntrypoint<Env, AnalyzeParams> {
  async run(_event: WorkflowEvent<AnalyzeParams>, _step: WorkflowStep): Promise<void> {
    throw new NonRetryableError("internal: pipeline steps are added in step B08");
  }
}

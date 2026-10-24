// Errors of the analysis step, with the transcript error code they end in (docs/backend/ai-analysis.md).
import Anthropic from "@anthropic-ai/sdk";
import type { TranscriptErrorCode } from "shared";

export type AnalysisErrorCode = Exclude<TranscriptErrorCode, "internal">;

export class AnalysisError extends Error {
  constructor(
    readonly code: AnalysisErrorCode,
    readonly retryable: boolean,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${code}: ${message}`, options);
    this.name = "AnalysisError";
  }
}

// SDK errors become analysis_failed: rate limits, overload, server and connection errors can be retried, every
// other API error cannot. Any other error is returned unchanged.
export function fromSdkError(error: unknown): unknown {
  if (!(error instanceof Anthropic.APIError)) return error;
  const what = `${error.constructor.name}${error.status === undefined ? "" : ` ${error.status}`}`;
  const retryable =
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError;
  return new AnalysisError("analysis_failed", retryable, what, { cause: error });
}

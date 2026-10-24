// Pure helpers of the Sources pages: the sample curl request and event formatting.
import type { HookOutcome } from "shared";
import sampleBody from "shared/fixtures/json/transcript.json?raw";

// Wraps a value in single quotes for a POSIX shell; a single quote inside becomes '\''.
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function sampleCurl(webhookUrl: string, body: string = sampleBody): string {
  const compact = JSON.stringify(JSON.parse(body));
  return [
    `curl -X POST ${shellQuote(webhookUrl)}`,
    `  -H 'Content-Type: application/json'`,
    `  --data ${shellQuote(compact)}`,
  ].join(" \\\n");
}

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function outcomeWithError(
  outcome: HookOutcome,
  errorCode: string | null,
  names: Record<HookOutcome, string>,
): string {
  return errorCode ? `${names[outcome]}: ${errorCode}` : names[outcome];
}

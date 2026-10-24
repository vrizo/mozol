// One JSON object per line, rid first. Only ids, counts, timings and error codes: never bodies.
export type LogFields = Record<string, string | number | boolean | null>;

export function log(rid: string, evt: string, fields: LogFields = {}): void {
  console.log(JSON.stringify({ rid, evt, ...fields }));
}

export function logError(rid: string, evt: string, fields: LogFields = {}): void {
  console.error(JSON.stringify({ rid, evt, level: "error", ...fields }));
}

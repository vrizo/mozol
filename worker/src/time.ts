// ISO 8601 UTC times with milliseconds, as stored in every time column: "2026-10-24T12:00:00.000Z".
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(toMs(iso) + seconds * 1000).toISOString();
}

export function addDays(iso: string, days: number): string {
  return new Date(toMs(iso) + days * 86_400_000).toISOString();
}

function toMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!ISO_UTC_MS.test(iso) || Number.isNaN(ms)) {
    throw new Error(`time: not an ISO UTC time with milliseconds: ${iso}`);
  }
  return ms;
}

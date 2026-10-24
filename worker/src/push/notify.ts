// The deliveries push to every device of a user that can receive pushes (docs/backend/pipeline.md, notify).
import type { DeviceRow } from "../db/devices";
import type { Env } from "../env";
import { log } from "../log";
import { type FetchFn, RetryablePushError, send, workerFetch } from "./apns";
import { pushConfig } from "./config";
import { deliveriesPayload, pushHeaders } from "./payloads";

export type NotifyCounts = { sent: number; skipped: number; failed: number };

// At least one device got 429 or 5xx; the others were tried.
export class RetryableNotifyError extends Error {
  constructor(readonly counts: NotifyCounts) {
    super(`push: ${counts.failed} device(s) failed, at least one with 429 or 5xx`);
    this.name = "RetryableNotifyError";
  }
}

// skipped: devices without an APNs token or with push disabled. failed: APNs rejected the push or the device.
export async function notifyUser(
  env: Env,
  userId: string,
  { pending }: { pending: number },
  io: { rid: string; fetch?: FetchFn },
): Promise<NotifyCounts> {
  const ctx = { db: env.DB, config: pushConfig(env), fetch: io.fetch ?? workerFetch, rid: io.rid };
  const payload = deliveriesPayload(pending);
  const { results } = await env.DB.prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY created_at, id")
    .bind(userId)
    .all<DeviceRow>();

  const counts: NotifyCounts = { sent: 0, skipped: 0, failed: 0 };
  let retryable = false;
  for (const device of results) {
    if (device.apns_token === null || device.push_disabled_at !== null) {
      counts.skipped++;
      continue;
    }
    try {
      const result = await send(ctx, device, payload, pushHeaders(device.bundle_id));
      if (result.outcome === "sent" || result.outcome === "logged") counts.sent++;
      else counts.failed++;
    } catch (error) {
      if (!(error instanceof RetryablePushError)) throw error;
      counts.failed++;
      retryable = true;
    }
  }
  log(io.rid, "push_notify", { user: userId, pending, ...counts });
  if (retryable) throw new RetryableNotifyError(counts);
  return counts;
}

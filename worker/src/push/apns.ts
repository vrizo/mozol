// One push to one device through the APNs provider API, or into push_log only in log mode (docs/backend/push.md).
import type { DeviceRow } from "../db/devices";
import { newId } from "../ids";
import { log, logError } from "../log";
import { nowIso } from "../time";
import { type PushConfig, PushNotConfiguredError } from "./config";
import type { PushHeaders, PushPayload } from "./payloads";
import { providerToken } from "./token";

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

// workerd refuses a stored global fetch called through a property.
export const workerFetch: FetchFn = (input, init) => fetch(input, init);

export type PushContext = { db: D1Database; config: PushConfig; fetch: FetchFn; rid: string };

export type PushDevice = Pick<DeviceRow, "id" | "user_id" | "bundle_id" | "apns_token" | "apns_environment">;

// sent: APNs accepted it; logged: log mode; disabled: APNs rejected the device token; rejected: another 4xx.
export type SendOutcome = "sent" | "logged" | "disabled" | "rejected";
export type SendResult = { outcome: SendOutcome; status: number | null; reason: string | null };

// APNs answered 429 or 5xx: the caller may try again later.
export class RetryablePushError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(`push: APNs answered ${status}${reason === null ? "" : ` ${reason}`}`);
    this.name = "RetryablePushError";
  }
}

const HOSTS = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;

const PROVIDER_TOKEN_REASONS = new Set(["ExpiredProviderToken", "InvalidProviderToken"]);

export async function send(
  ctx: PushContext,
  device: PushDevice,
  payload: PushPayload,
  headers: PushHeaders,
): Promise<SendResult> {
  const type = payload.mozol.type;
  if (device.apns_token === null || device.apns_environment === null) {
    throw new Error(`push: device ${device.id} has no APNs token`);
  }

  if (ctx.config.mode === "log") {
    await writeLog(ctx.db, device, type, { apnsId: null, status: null, reason: null });
    log(ctx.rid, "push_logged", { type, device: device.id });
    return { outcome: "logged", status: null, reason: null };
  }
  const key = ctx.config.apns;
  if (key === null) throw new PushNotConfiguredError();

  const url = `${HOSTS[device.apns_environment]}/3/device/${device.apns_token}`;
  const body = JSON.stringify(payload);
  let answer = await request(ctx, url, body, headers, await providerToken(ctx.db, key));
  await writeLog(ctx.db, device, type, answer);
  if (answer.status === 403 && answer.reason !== null && PROVIDER_TOKEN_REASONS.has(answer.reason)) {
    log(ctx.rid, "apns_token_renewed", { reason: answer.reason });
    answer = await request(ctx, url, body, headers, await providerToken(ctx.db, key, { fresh: true }));
    await writeLog(ctx.db, device, type, answer);
  }

  const { status, reason } = answer;
  const fields = { type, device: device.id, status, reason, apnsId: answer.apnsId };
  if (status === 200) {
    log(ctx.rid, "push_sent", fields);
    return { outcome: "sent", status, reason };
  }
  if (status === 410 || (status === 400 && reason === "BadDeviceToken")) {
    await disableDevice(ctx.db, device, reason ?? String(status));
    logError(ctx.rid, "push_device_disabled", fields);
    return { outcome: "disabled", status, reason };
  }
  if (status === 429 || status >= 500) {
    logError(ctx.rid, "push_retryable", fields);
    throw new RetryablePushError(status, reason);
  }
  logError(ctx.rid, "push_rejected", fields);
  return { outcome: "rejected", status, reason };
}

type Answer = { apnsId: string | null; status: number | null; reason: string | null };

async function request(
  ctx: PushContext,
  url: string,
  body: string,
  headers: PushHeaders,
  token: string,
): Promise<Answer & { status: number }> {
  const res = await ctx.fetch(url, {
    method: "POST",
    headers: { ...headers, authorization: `bearer ${token}`, "content-type": "application/json" },
    body,
  });
  return { apnsId: res.headers.get("apns-id"), status: res.status, reason: await readReason(res) };
}

// APNs error answers carry { "reason": "..." }; a 200 has an empty body.
async function readReason(res: Response): Promise<string | null> {
  const text = await res.text();
  if (text === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "unreadable_answer";
  }
  const reason = (value as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" ? reason : "unreadable_answer";
}

async function writeLog(db: D1Database, device: PushDevice, type: string, answer: Answer): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_log (id, user_id, device_id, push_type, apns_id, status, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId("psh"),
      device.user_id,
      device.id,
      type,
      answer.apnsId,
      answer.status,
      answer.reason,
      nowIso(),
    )
    .run();
}

// Only while the device still has the rejected token: a token registered in the meantime stays enabled.
async function disableDevice(db: D1Database, device: PushDevice, reason: string): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `UPDATE devices SET push_disabled_at = ?, push_disabled_reason = ?, updated_at = ?
       WHERE id = ? AND apns_token = ?`,
    )
    .bind(now, reason, now, device.id, device.apns_token)
    .run();
}

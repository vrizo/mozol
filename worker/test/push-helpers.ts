// Devices, APNs keys and a fake APNs for the device and push tests.
import { env } from "cloudflare:workers";
import { DeviceResponse } from "shared";
import { expect } from "vitest";
import { toBase64 } from "../src/auth/bytes";
import type { DeviceRow } from "../src/db/devices";
import type { FetchFn } from "../src/push/apns";
import type { ApnsKey } from "../src/push/config";
import { call } from "./helpers";

export function hexToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function installationId(): string {
  return `install-${crypto.randomUUID().slice(0, 8)}`;
}

export function deviceBody(overrides: Record<string, unknown> = {}) {
  return {
    platform: "ios",
    bundleId: "net.vrizo.mozol",
    appVersion: "1.0 (1)",
    osVersion: "27.0",
    apnsToken: hexToken(),
    apnsEnvironment: "sandbox",
    remindersAccess: "full",
    ...overrides,
  };
}

export async function putDevice(
  auth: { cookie?: string; bearer?: string },
  id: string,
  body: Record<string, unknown> = deviceBody(),
) {
  const res = await call(`/api/devices/${id}`, { ...auth, method: "PUT", body });
  expect(res.status).toBe(200);
  return DeviceResponse.parse(await res.json()).device;
}

export async function deviceRow(id: string): Promise<DeviceRow> {
  const row = await env.DB.prepare("SELECT * FROM devices WHERE installation_id = ?")
    .bind(id)
    .first<DeviceRow>();
  if (row === null) throw new Error(`deviceRow: no device ${id}`);
  return row;
}

export async function pushLog(deviceId: string) {
  const { results } = await env.DB.prepare(
    "SELECT push_type, apns_id, status, reason FROM push_log WHERE device_id = ? ORDER BY created_at, id",
  )
    .bind(deviceId)
    .all<{ push_type: string; apns_id: string | null; status: number | null; reason: string | null }>();
  return results;
}

export type KeyPair = { key: ApnsKey; publicKey: CryptoKey };

export async function apnsKey(): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  return {
    key: {
      keyId: `K${crypto.randomUUID().slice(0, 9).toUpperCase()}`,
      teamId: "TEAM123456",
      privateKey: toBase64(new Uint8Array(pkcs8)),
    },
    publicKey: pair.publicKey,
  };
}

export type ApnsCall = { url: string; headers: Headers; body: string };
export type ApnsAnswer = { status: number; reason?: string };

// Answers the requests in order with the given answers; the last answer repeats.
export function fakeApns(...answers: ApnsAnswer[]): { fetch: FetchFn; calls: ApnsCall[] } {
  const calls: ApnsCall[] = [];
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url, headers: new Headers(init.headers), body: String(init.body) });
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer === undefined) throw new Error("fakeApns: no answers");
    const body = answer.reason === undefined ? null : JSON.stringify({ reason: answer.reason });
    return new Response(body, { status: answer.status, headers: { "apns-id": `apns-${calls.length}` } });
  };
  return { fetch, calls };
}

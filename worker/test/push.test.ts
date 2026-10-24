import { env } from "cloudflare:workers";
import { DeliveriesPush, TestPush } from "shared";
import { describe, expect, it } from "vitest";
import { type PushContext, RetryablePushError, send } from "../src/push/apns";
import { pushConfig } from "../src/push/config";
import { notifyUser, RetryableNotifyError } from "../src/push/notify";
import { deliveriesPayload, MAX_PAYLOAD_BYTES, pushHeaders, testPayload } from "../src/push/payloads";
import { providerToken } from "../src/push/token";
import { signUp } from "./helpers";
import {
  type ApnsAnswer,
  apnsKey,
  deviceBody,
  deviceRow,
  fakeApns,
  installationId,
  type KeyPair,
  pushLog,
  putDevice,
} from "./push-helpers";

function decodePart(part: string): unknown {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

function signatureBytes(part: string): Uint8Array<ArrayBuffer> {
  const binary = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function deviceFor(environment: "sandbox" | "production" = "sandbox") {
  const { cookie } = await signUp();
  const id = installationId();
  await putDevice({ cookie }, id, deviceBody({ apnsEnvironment: environment }));
  return deviceRow(id);
}

async function apnsContext(pair: KeyPair, ...answers: ApnsAnswer[]) {
  const apns = fakeApns(...answers);
  const ctx: PushContext = {
    db: env.DB,
    config: { mode: "apns", apns: pair.key },
    fetch: apns.fetch,
    rid: "test",
  };
  return { ctx, calls: apns.calls };
}

describe("pushConfig", () => {
  it("reads log and apns mode and refuses any other value", async () => {
    const { key } = await apnsKey();
    const secrets = { APNS_KEY_ID: key.keyId, APNS_TEAM_ID: key.teamId, APNS_PRIVATE_KEY: key.privateKey };
    expect(pushConfig({ ...env, PUSH_MODE: "log" })).toEqual({ mode: "log" });
    expect(pushConfig({ ...env, PUSH_MODE: "apns", ...secrets })).toEqual({ mode: "apns", apns: key });
    expect(pushConfig({ ...env, PUSH_MODE: "apns", ...secrets, APNS_TEAM_ID: undefined })).toEqual({
      mode: "apns",
      apns: null,
    });
    expect(() => pushConfig({ ...env, PUSH_MODE: "sandbox" })).toThrow(/unknown PUSH_MODE/);
  });
});

describe("providerToken", () => {
  it("signs an ES256 JWT that the public key verifies", async () => {
    const pair = await apnsKey();
    const nowMs = Date.parse("2026-10-24T12:00:00.000Z");
    const token = await providerToken(env.DB, pair.key, { nowMs });
    const [header, claims, signature] = token.split(".");
    if (header === undefined || claims === undefined || signature === undefined) throw new Error("not a JWT");
    expect(decodePart(header)).toEqual({ alg: "ES256", kid: pair.key.keyId });
    expect(decodePart(claims)).toEqual({ iss: pair.key.teamId, iat: nowMs / 1000 });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      signatureBytes(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it("reuses the stored token for 50 minutes, then makes a new one", async () => {
    const pair = await apnsKey();
    const nowMs = Date.parse("2026-10-24T12:00:00.000Z");
    const first = await providerToken(env.DB, pair.key, { nowMs });
    expect(await providerToken(env.DB, pair.key, { nowMs: nowMs + 49 * 60_000 })).toBe(first);
    const stored = await env.DB.prepare("SELECT value FROM worker_state WHERE key = 'apns_token'").first<{
      value: string;
    }>();
    expect(JSON.parse(stored?.value ?? "null")).toMatchObject({ token: first, issuedAt: nowMs / 1000 });

    const later = await providerToken(env.DB, pair.key, { nowMs: nowMs + 50 * 60_000 });
    expect(later).not.toBe(first);
    expect(await providerToken(env.DB, pair.key, { nowMs: nowMs + 51 * 60_000 })).toBe(later);
    expect(await providerToken(env.DB, pair.key, { nowMs: nowMs + 51 * 60_000, fresh: true })).not.toBe(
      later,
    );
  });

  it("makes a new token for another key", async () => {
    const a = await apnsKey();
    const b = await apnsKey();
    const tokenA = await providerToken(env.DB, a.key);
    const tokenB = await providerToken(env.DB, b.key);
    expect(tokenB).not.toBe(tokenA);
    expect(decodePart(tokenB.split(".")[0] ?? "")).toMatchObject({ kid: b.key.keyId });
  });
});

describe("send", () => {
  it("posts to the sandbox host with the token and contract headers and logs 200", async () => {
    const pair = await apnsKey();
    const device = await deviceFor("sandbox");
    const { ctx, calls } = await apnsContext(pair, { status: 200 });
    const result = await send(ctx, device, deliveriesPayload(2), pushHeaders(device.bundle_id));
    expect(result).toEqual({ outcome: "sent", status: 200, reason: null });
    expect(calls).toHaveLength(1);
    const [req] = calls;
    expect(req?.url).toBe(`https://api.sandbox.push.apple.com/3/device/${device.apns_token}`);
    expect(req?.headers.get("authorization")).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(req?.headers.get("apns-push-type")).toBe("background");
    expect(req?.headers.get("apns-priority")).toBe("5");
    expect(req?.headers.get("apns-topic")).toBe("net.vrizo.mozol");
    expect(JSON.parse(req?.body ?? "")).toEqual({
      aps: { "content-available": 1 },
      mozol: { v: 1, type: "deliveries", pending: 2 },
    });
    expect(await pushLog(device.id)).toEqual([
      { push_type: "deliveries", apns_id: "apns-1", status: 200, reason: null },
    ]);
  });

  it("posts to the production host for a production device", async () => {
    const pair = await apnsKey();
    const device = await deviceFor("production");
    const { ctx, calls } = await apnsContext(pair, { status: 200 });
    await send(ctx, device, testPayload(), pushHeaders(device.bundle_id));
    expect(calls[0]?.url).toBe(`https://api.push.apple.com/3/device/${device.apns_token}`);
  });

  it.each([
    { status: 410, reason: "Unregistered" },
    { status: 410, reason: "ExpiredToken" },
    { status: 400, reason: "BadDeviceToken" },
  ])("disables the device on $status $reason", async (answer) => {
    const pair = await apnsKey();
    const device = await deviceFor();
    const { ctx } = await apnsContext(pair, answer);
    const result = await send(ctx, device, testPayload(), pushHeaders(device.bundle_id));
    expect(result.outcome).toBe("disabled");
    const row = await deviceRow(device.installation_id);
    expect(row.push_disabled_reason).toBe(answer.reason);
    expect(row.push_disabled_at).not.toBeNull();
    expect(await pushLog(device.id)).toEqual([{ push_type: "test", apns_id: "apns-1", ...answer }]);
  });

  it.each(["ExpiredProviderToken", "InvalidProviderToken"])(
    "retries once with a new token on 403 %s",
    async (reason) => {
      const pair = await apnsKey();
      const device = await deviceFor();
      const { ctx, calls } = await apnsContext(pair, { status: 403, reason }, { status: 200 });
      const result = await send(ctx, device, testPayload(), pushHeaders(device.bundle_id));
      expect(result.outcome).toBe("sent");
      expect(calls).toHaveLength(2);
      expect(calls[1]?.headers.get("authorization")).not.toBe(calls[0]?.headers.get("authorization"));
      expect((await pushLog(device.id)).map((r) => [r.status, r.reason])).toEqual([
        [403, reason],
        [200, null],
      ]);
    },
  );

  it("retries a provider token answer only once", async () => {
    const pair = await apnsKey();
    const device = await deviceFor();
    const { ctx, calls } = await apnsContext(pair, { status: 403, reason: "InvalidProviderToken" });
    const result = await send(ctx, device, testPayload(), pushHeaders(device.bundle_id));
    expect(result).toEqual({ outcome: "rejected", status: 403, reason: "InvalidProviderToken" });
    expect(calls).toHaveLength(2);
  });

  it.each([
    { status: 429, reason: "TooManyRequests" },
    { status: 500, reason: "InternalServerError" },
    { status: 503, reason: "ServiceUnavailable" },
  ])("throws a retryable error on $status", async (answer) => {
    const pair = await apnsKey();
    const device = await deviceFor();
    const { ctx } = await apnsContext(pair, answer);
    await expect(send(ctx, device, testPayload(), pushHeaders(device.bundle_id))).rejects.toBeInstanceOf(
      RetryablePushError,
    );
    expect((await pushLog(device.id)).map((r) => r.status)).toEqual([answer.status]);
    expect((await deviceRow(device.installation_id)).push_disabled_at).toBeNull();
  });

  it("logs another 4xx without a retry and keeps the device enabled", async () => {
    const pair = await apnsKey();
    const device = await deviceFor();
    const { ctx, calls } = await apnsContext(pair, { status: 400, reason: "BadTopic" });
    const result = await send(ctx, device, testPayload(), pushHeaders(device.bundle_id));
    expect(result).toEqual({ outcome: "rejected", status: 400, reason: "BadTopic" });
    expect(calls).toHaveLength(1);
    expect((await deviceRow(device.installation_id)).push_disabled_at).toBeNull();
  });

  it("writes push_log with status null and sends nothing in log mode", async () => {
    const device = await deviceFor();
    const apns = fakeApns({ status: 200 });
    const ctx: PushContext = { db: env.DB, config: { mode: "log" }, fetch: apns.fetch, rid: "test" };
    expect((await send(ctx, device, deliveriesPayload(1), pushHeaders(device.bundle_id))).outcome).toBe(
      "logged",
    );
    expect(apns.calls).toEqual([]);
    expect(await pushLog(device.id)).toEqual([
      { push_type: "deliveries", apns_id: null, status: null, reason: null },
    ]);
  });
});

describe("payloads", () => {
  it("parse with the shared push schemas and stay under 4096 bytes", () => {
    const deliveries = deliveriesPayload(3);
    expect(DeliveriesPush.parse(deliveries)).toEqual(deliveries);
    const test = testPayload();
    expect(TestPush.parse(test)).toEqual(test);
    for (const payload of [deliveries, deliveriesPayload(Number.MAX_SAFE_INTEGER), test]) {
      expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(MAX_PAYLOAD_BYTES);
    }
    expect(() => deliveriesPayload(0)).toThrow();
  });

  it("set the background headers with an expiration one hour ahead", () => {
    const nowMs = Date.parse("2026-10-24T12:00:00.000Z");
    expect(pushHeaders("net.vrizo.mozol", nowMs)).toEqual({
      "apns-push-type": "background",
      "apns-priority": "5",
      "apns-topic": "net.vrizo.mozol",
      "apns-expiration": String(nowMs / 1000 + 3600),
    });
  });
});

describe("notifyUser", () => {
  async function userWithDevices() {
    const { cookie, user } = await signUp();
    const a = await putDevice({ cookie }, installationId());
    const b = await putDevice({ cookie }, installationId());
    await putDevice({ cookie }, installationId(), deviceBody({ apnsToken: null, apnsEnvironment: null }));
    const disabled = await putDevice({ cookie }, installationId());
    await env.DB.prepare(
      "UPDATE devices SET push_disabled_at = ?, push_disabled_reason = 'Unregistered' WHERE id = ?",
    )
      .bind(new Date().toISOString(), disabled.id)
      .run();
    return { user, a, b };
  }

  it("sends the deliveries push to every device with a token that is not disabled", async () => {
    const { user, a, b } = await userWithDevices();
    const counts = await notifyUser({ ...env, PUSH_MODE: "log" }, user.id, { pending: 2 }, { rid: "test" });
    expect(counts).toEqual({ sent: 2, skipped: 2, failed: 0 });
    for (const device of [a, b]) {
      expect(await pushLog(device.id)).toEqual([
        { push_type: "deliveries", apns_id: null, status: null, reason: null },
      ]);
    }
  });

  it("tries every device and throws a retryable error when one got 5xx", async () => {
    const { user, a, b } = await userWithDevices();
    const pair = await apnsKey();
    const apns = fakeApns({ status: 500, reason: "InternalServerError" }, { status: 200 });
    const secrets = {
      APNS_KEY_ID: pair.key.keyId,
      APNS_TEAM_ID: pair.key.teamId,
      APNS_PRIVATE_KEY: pair.key.privateKey,
    };
    const run = notifyUser(
      { ...env, PUSH_MODE: "apns", ...secrets },
      user.id,
      { pending: 1 },
      { rid: "test", fetch: apns.fetch },
    );
    const error = await run.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryableNotifyError);
    expect((error as RetryableNotifyError).counts).toEqual({ sent: 1, skipped: 2, failed: 1 });
    expect((await pushLog(a.id)).map((r) => r.status)).toEqual([500]);
    expect((await pushLog(b.id)).map((r) => r.status)).toEqual([200]);
  });

  it("counts a disabled device as failed without throwing", async () => {
    const { user } = await userWithDevices();
    const pair = await apnsKey();
    const apns = fakeApns({ status: 410, reason: "Unregistered" }, { status: 200 });
    const secrets = {
      APNS_KEY_ID: pair.key.keyId,
      APNS_TEAM_ID: pair.key.teamId,
      APNS_PRIVATE_KEY: pair.key.privateKey,
    };
    const counts = await notifyUser(
      { ...env, PUSH_MODE: "apns", ...secrets },
      user.id,
      { pending: 1 },
      { rid: "test", fetch: apns.fetch },
    );
    expect(counts).toEqual({ sent: 1, skipped: 2, failed: 1 });
  });
});

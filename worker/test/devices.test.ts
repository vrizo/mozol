import { env } from "cloudflare:workers";
import { DevicesResponse, TestPushResponse } from "shared";
import { describe, expect, it } from "vitest";
import { appToken, call, expectError, signUp } from "./helpers";
import { deviceBody, deviceRow, hexToken, installationId, pushLog, putDevice } from "./push-helpers";

async function disable(id: string) {
  await env.DB.prepare(
    "UPDATE devices SET push_disabled_at = ?, push_disabled_reason = 'Unregistered' WHERE installation_id = ?",
  )
    .bind(new Date().toISOString(), id)
    .run();
}

describe("PUT /api/devices/:installationId", () => {
  it("creates the device, then updates it in place", async () => {
    const { cookie } = await signUp();
    const bearer = await appToken(cookie);
    const id = installationId();
    const created = await putDevice({ bearer }, id, deviceBody({ remindersAccess: "not_determined" }));
    expect(created).toMatchObject({
      installationId: id,
      platform: "ios",
      appVersion: "1.0 (1)",
      osVersion: "27.0",
      pushEnabled: true,
      remindersAccess: "not_determined",
    });
    expect(created.id).toMatch(/^dev_/);

    const updated = await putDevice(
      { bearer },
      id,
      deviceBody({ apnsToken: null, apnsEnvironment: null, appVersion: "1.1 (2)", remindersAccess: "full" }),
    );
    expect(updated).toMatchObject({
      id: created.id,
      appVersion: "1.1 (2)",
      pushEnabled: false,
      remindersAccess: "full",
    });
    expect(updated.lastSeenAt >= created.lastSeenAt).toBe(true);
    const row = await deviceRow(id);
    expect(row).toMatchObject({ apns_token: null, apns_environment: null, bundle_id: "net.vrizo.mozol" });
  });

  it("moves a device of another user to the current user", async () => {
    const first = await signUp();
    const second = await signUp();
    const id = installationId();
    const device = await putDevice({ cookie: first.cookie }, id);
    const moved = await putDevice({ cookie: second.cookie }, id);
    expect(moved.id).toBe(device.id);
    expect((await deviceRow(id)).user_id).toBe(second.user.id);

    const list = (c: string) =>
      call("/api/devices", { cookie: c }).then(async (r) => DevicesResponse.parse(await r.json()));
    expect((await list(first.cookie)).devices).toEqual([]);
    expect((await list(second.cookie)).devices.map((d) => d.id)).toEqual([device.id]);
  });

  it("clears the disabled state on a new token and keeps it on the same token", async () => {
    const { cookie } = await signUp();
    const id = installationId();
    const body = deviceBody();
    await putDevice({ cookie }, id, body);
    await disable(id);

    expect((await putDevice({ cookie }, id, body)).pushEnabled).toBe(false);
    expect((await deviceRow(id)).push_disabled_reason).toBe("Unregistered");

    expect((await putDevice({ cookie }, id, { ...body, apnsToken: hexToken() })).pushEnabled).toBe(true);
    expect(await deviceRow(id)).toMatchObject({ push_disabled_at: null, push_disabled_reason: null });
  });

  it("clears the disabled state when only the APNs environment changes", async () => {
    const { cookie } = await signUp();
    const id = installationId();
    const body = deviceBody();
    await putDevice({ cookie }, id, body);
    await disable(id);

    expect((await putDevice({ cookie }, id, { ...body, apnsEnvironment: "production" })).pushEnabled).toBe(
      true,
    );
    expect(await deviceRow(id)).toMatchObject({ push_disabled_at: null, push_disabled_reason: null });
  });

  it("refuses a body that breaks the contract and a bad installation id", async () => {
    const { cookie } = await signUp();
    const id = installationId();
    const res = await call(`/api/devices/${id}`, {
      cookie,
      method: "PUT",
      body: deviceBody({ apnsEnvironment: null }),
    });
    await expectError(res, 400, "validation_failed");
    const bad = await call("/api/devices/x", { cookie, method: "PUT", body: deviceBody() });
    await expectError(bad, 400, "validation_failed");
  });

  it("needs a session", async () => {
    await expectError(
      await call(`/api/devices/${installationId()}`, { method: "PUT", body: deviceBody() }),
      401,
      "unauthorized",
    );
  });
});

describe("GET and DELETE /api/devices", () => {
  it("lists the user's devices and deletes one", async () => {
    const { cookie } = await signUp();
    const a = await putDevice({ cookie }, installationId());
    const b = await putDevice({ cookie }, installationId());
    const res = await call("/api/devices", { cookie });
    expect(res.status).toBe(200);
    expect(DevicesResponse.parse(await res.json()).devices.map((d) => d.id)).toEqual([a.id, b.id]);

    const deleted = await call(`/api/devices/${a.installationId}`, { cookie, method: "DELETE" });
    expect(deleted.status).toBe(204);
    const after = DevicesResponse.parse(await (await call("/api/devices", { cookie })).json());
    expect(after.devices.map((d) => d.id)).toEqual([b.id]);
    await expectError(
      await call(`/api/devices/${a.installationId}`, { cookie, method: "DELETE" }),
      404,
      "not_found",
    );
  });

  it("does not delete a device of another user", async () => {
    const owner = await signUp();
    const other = await signUp();
    const device = await putDevice({ cookie: owner.cookie }, installationId());
    const res = await call(`/api/devices/${device.installationId}`, {
      cookie: other.cookie,
      method: "DELETE",
    });
    await expectError(res, 404, "not_found");
    expect((await deviceRow(device.installationId)).id).toBe(device.id);
  });
});

describe("POST /api/devices/:installationId/test-push", () => {
  it("writes push_log in log mode and answers 202", async () => {
    const { cookie } = await signUp();
    const device = await putDevice({ cookie }, installationId());
    const res = await call(`/api/devices/${device.installationId}/test-push`, { cookie, method: "POST" });
    expect(res.status).toBe(202);
    expect(TestPushResponse.parse(await res.json())).toEqual({ ok: true });
    expect(await pushLog(device.id)).toEqual([
      { push_type: "test", apns_id: null, status: null, reason: null },
    ]);
  });

  it("answers 503 push_not_configured in apns mode without the APNs secrets", async () => {
    const { cookie } = await signUp();
    const device = await putDevice({ cookie }, installationId());
    const res = await call(`/api/devices/${device.installationId}/test-push`, {
      cookie,
      method: "POST",
      bindings: {
        PUSH_MODE: "apns",
        APNS_KEY_ID: undefined,
        APNS_TEAM_ID: undefined,
        APNS_PRIVATE_KEY: undefined,
      },
    });
    await expectError(res, 503, "push_not_configured");
    expect(await pushLog(device.id)).toEqual([]);
  });

  it("answers 404 for an unknown or foreign device and a device without a token", async () => {
    const owner = await signUp();
    const other = await signUp();
    const device = await putDevice({ cookie: owner.cookie }, installationId());
    const post = (cookie: string, id: string) =>
      call(`/api/devices/${id}/test-push`, { cookie, method: "POST" });
    await expectError(await post(owner.cookie, installationId()), 404, "not_found");
    await expectError(await post(other.cookie, device.installationId), 404, "not_found");

    const silent = await putDevice(
      { cookie: owner.cookie },
      installationId(),
      deviceBody({ apnsToken: null, apnsEnvironment: null }),
    );
    await expectError(await post(owner.cookie, silent.installationId), 404, "not_found");
  });

  it("fails loudly on an unknown PUSH_MODE", async () => {
    const { cookie } = await signUp();
    const device = await putDevice({ cookie }, installationId());
    const res = await call(`/api/devices/${device.installationId}/test-push`, {
      cookie,
      method: "POST",
      bindings: { PUSH_MODE: "fake" },
    });
    await expectError(res, 500, "internal");
  });
});

// /api/devices: the user's iOS devices, their push registration and the test push
// (shared/CONTRACT.md, "Endpoints: devices"; docs/backend/push.md).
import { Hono } from "hono";
import { DeviceResponse, DevicesResponse, InstallationId, PutDeviceBody, TestPushResponse } from "shared";
import { requireUser } from "../auth/session";
import { type DeviceRow, deviceFromRow, findDevice } from "../db/devices";
import type { AppEnv } from "../env";
import { ApiError, parseInput, readJson } from "../errors";
import { newId } from "../ids";
import { log } from "../log";
import { send, workerFetch } from "../push/apns";
import { pushConfig } from "../push/config";
import { pushHeaders, testPayload } from "../push/payloads";
import { nowIso } from "../time";

export const deviceRoutes = new Hono<AppEnv>();

deviceRoutes.get("/", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM devices WHERE user_id = ? ORDER BY created_at, id",
  )
    .bind(c.var.user.id)
    .all<DeviceRow>();
  return c.json(DevicesResponse.parse({ devices: results.map(deviceFromRow) }));
});

// One statement: a device of another user moves to this one, and a new or changed APNs token clears the
// disabled state.
deviceRoutes.put("/:installationId", requireUser, async (c) => {
  const installationId = parseInput(InstallationId, c.req.param("installationId"));
  const body = await readJson(c, PutDeviceBody);
  const previous = await c.env.DB.prepare("SELECT user_id FROM devices WHERE installation_id = ?")
    .bind(installationId)
    .first<{ user_id: string }>();
  const now = nowIso();
  const row = await c.env.DB.prepare(
    `INSERT INTO devices (id, user_id, installation_id, platform, bundle_id, apns_token, apns_environment,
       app_version, os_version, reminders_access, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (installation_id) DO UPDATE SET
       user_id = excluded.user_id,
       platform = excluded.platform,
       bundle_id = excluded.bundle_id,
       push_disabled_at = CASE WHEN devices.apns_token IS excluded.apns_token AND devices.apns_environment IS excluded.apns_environment
         THEN devices.push_disabled_at END,
       push_disabled_reason = CASE WHEN devices.apns_token IS excluded.apns_token AND devices.apns_environment IS excluded.apns_environment
         THEN devices.push_disabled_reason END,
       apns_token = excluded.apns_token,
       apns_environment = excluded.apns_environment,
       app_version = excluded.app_version,
       os_version = excluded.os_version,
       reminders_access = excluded.reminders_access,
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at
     RETURNING *`,
  )
    .bind(
      newId("dev"),
      c.var.user.id,
      installationId,
      body.platform,
      body.bundleId,
      body.apnsToken,
      body.apnsEnvironment,
      body.appVersion,
      body.osVersion,
      body.remindersAccess,
      now,
      now,
      now,
    )
    .first<DeviceRow>();
  if (row === null) throw new Error("PUT /api/devices: the upsert returned no row");
  if (previous === null) log(c.get("rid"), "device_created", { device: row.id });
  else if (previous.user_id !== c.var.user.id)
    log(c.get("rid"), "device_moved", { device: row.id, from: previous.user_id });
  return c.json(DeviceResponse.parse({ device: deviceFromRow(row) }));
});

deviceRoutes.delete("/:installationId", requireUser, async (c) => {
  const result = await c.env.DB.prepare("DELETE FROM devices WHERE user_id = ? AND installation_id = ?")
    .bind(c.var.user.id, c.req.param("installationId"))
    .run();
  if (result.meta.changes === 0) throw new ApiError(404, "not_found");
  log(c.get("rid"), "device_deleted", { installation: c.req.param("installationId") });
  return c.body(null, 204);
});

// A device without an APNs token has nothing to send to: not_found. A disabled device gets the test push.
deviceRoutes.post("/:installationId/test-push", requireUser, async (c) => {
  const device = await findDevice(c.env.DB, c.var.user.id, c.req.param("installationId"));
  if (device === null || device.apns_token === null) throw new ApiError(404, "not_found");
  const config = pushConfig(c.env);
  if (config.mode === "apns" && config.apns === null) throw new ApiError(503, "push_not_configured");
  const ctx = { db: c.env.DB, config, fetch: workerFetch, rid: c.get("rid") };
  await send(ctx, device, testPayload(), pushHeaders(device.bundle_id));
  return c.json(TestPushResponse.parse({ ok: true }), 202);
});

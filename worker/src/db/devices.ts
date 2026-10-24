// The devices table and its mapping to the API Device (shared/CONTRACT.md, docs/backend/data-model.md).
import { Device } from "shared";

export type DeviceRow = {
  id: string;
  user_id: string;
  installation_id: string;
  platform: string;
  bundle_id: string;
  apns_token: string | null;
  apns_environment: "sandbox" | "production" | null;
  app_version: string | null;
  os_version: string | null;
  reminders_access: string;
  push_disabled_at: string | null;
  push_disabled_reason: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export function deviceFromRow(row: DeviceRow): Device {
  return Device.parse({
    id: row.id,
    installationId: row.installation_id,
    platform: row.platform,
    appVersion: row.app_version,
    osVersion: row.os_version,
    pushEnabled: row.apns_token !== null && row.push_disabled_at === null,
    remindersAccess: row.reminders_access,
    lastSeenAt: row.last_seen_at,
  });
}

export async function findDevice(
  db: D1Database,
  userId: string,
  installationId: string,
): Promise<DeviceRow | null> {
  return db
    .prepare("SELECT * FROM devices WHERE user_id = ? AND installation_id = ?")
    .bind(userId, installationId)
    .first<DeviceRow>();
}

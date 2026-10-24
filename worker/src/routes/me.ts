// /api/me: read, change and delete the signed-in user's account (shared/CONTRACT.md, "Endpoints: accounts").
import { Hono } from "hono";
import { DeleteMeBody, PatchMeBody, UserResponse } from "shared";
import { verifyPassword } from "../auth/password";
import { clearSessionCookie, requireUser } from "../auth/session";
import { writeJson } from "../db/json";
import { findUserById, reminderSettingsColumn, type UserRow, userFromRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError, readJson } from "../errors";
import { log } from "../log";
import { nowIso } from "../time";

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", requireUser, (c) => c.json(UserResponse.parse({ user: c.var.user })));

meRoutes.patch("/", requireUser, async (c) => {
  const body = await readJson(c, PatchMeBody);
  const changes: [column: string, value: string][] = [];
  if (body.displayName !== undefined) changes.push(["display_name", body.displayName]);
  if (body.nativeLanguage !== undefined) changes.push(["native_language", body.nativeLanguage]);
  if (body.speakerNames !== undefined) changes.push(["speaker_names", writeJson(body.speakerNames)]);
  if (body.reminderSettings !== undefined) {
    changes.push(["reminder_settings", reminderSettingsColumn(body.reminderSettings)]);
  }
  if (changes.length === 0) return c.json(UserResponse.parse({ user: c.var.user }));

  const sets = changes.map(([column]) => `${column} = ?`).join(", ");
  const row = await c.env.DB.prepare(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(...changes.map(([, value]) => value), nowIso(), c.var.user.id)
    .first<UserRow>();
  if (row === null) throw new Error("PATCH /api/me: the user row does not exist");
  return c.json(UserResponse.parse({ user: userFromRow(row) }));
});

// The cascade on user_id removes every other row of the user (docs/backend/data-model.md).
meRoutes.delete("/", requireUser, async (c) => {
  const body = await readJson(c, DeleteMeBody);
  const row = await findUserById(c.env.DB, c.var.user.id);
  if (row === null) throw new Error("DELETE /api/me: the user row does not exist");
  if (!(await verifyPassword(body.password, row.password_hash))) {
    throw new ApiError(401, "invalid_credentials");
  }
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(row.id).run();
  log(c.get("rid"), "user_deleted", { user: row.id });
  clearSessionCookie(c);
  return c.body(null, 204);
});

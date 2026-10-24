// /api/auth: sign-up, sign-in, sign-out and the app sign-in handoff (shared/CONTRACT.md, "Endpoints: accounts").
import { Hono } from "hono";
import {
  AppCodeResponse,
  AppTokenBody,
  AppTokenResponse,
  type ReminderSettings,
  SignInBody,
  SignUpBody,
  UserResponse,
} from "shared";
import { hashPassword, verifyPassword } from "../auth/password";
import { authLimit } from "../auth/rate-limit";
import { clearSessionCookie, newSession, requireUser, setSessionCookie } from "../auth/session";
import { newToken, sha256Hex } from "../auth/tokens";
import { writeJson } from "../db/json";
import {
  findUserByEmail,
  findUserById,
  reminderSettingsColumn,
  type UserRow,
  userFromRow,
} from "../db/users";
import type { AppEnv } from "../env";
import { ApiError, readJson } from "../errors";
import { newId } from "../ids";
import { log } from "../log";
import { addSeconds, nowIso } from "../time";

const APP_CODE_SECONDS = 120;
const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  embedInMyReminders: true,
  intensity: "normal",
  activeFrom: "09:00",
  activeTo: "21:00",
};

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/sign-up", authLimit, async (c) => {
  const body = await readJson(c, SignUpBody);
  const userId = newId("usr");
  const now = nowIso();
  const insertUser = c.env.DB.prepare(
    `INSERT INTO users
       (id, email, password_hash, display_name, native_language, speaker_names, reminder_settings,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  ).bind(
    userId,
    body.email.toLowerCase(),
    await hashPassword(body.password),
    body.displayName,
    body.nativeLanguage,
    writeJson([body.displayName]),
    reminderSettingsColumn(DEFAULT_REMINDER_SETTINGS),
    now,
    now,
  );
  const session = await newSession(c, userId, "web", null);

  let row: UserRow | undefined;
  try {
    const [users] = await c.env.DB.batch<UserRow>([insertUser, session.insert]);
    row = users?.results[0];
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed: users.email")) {
      throw new ApiError(409, "email_taken");
    }
    throw err;
  }
  if (row === undefined) throw new Error("sign-up: the user insert returned no row");

  log(c.get("rid"), "user_created", { user: userId });
  setSessionCookie(c, session.token);
  return c.json(UserResponse.parse({ user: userFromRow(row) }), 201);
});

authRoutes.post("/sign-in", authLimit, async (c) => {
  const body = await readJson(c, SignInBody);
  const row = await findUserByEmail(c.env.DB, body.email.toLowerCase());
  if (row === null) {
    // One hash as for a known email, so the answer time does not tell whether the email has an account.
    await hashPassword(body.password);
    throw new ApiError(401, "invalid_credentials");
  }
  if (!(await verifyPassword(body.password, row.password_hash))) {
    throw new ApiError(401, "invalid_credentials");
  }

  const session = await newSession(c, row.id, "web", null);
  await session.insert.run();
  setSessionCookie(c, session.token);
  return c.json(UserResponse.parse({ user: userFromRow(row) }), 200);
});

authRoutes.post("/sign-out", requireUser, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(c.var.session.id).run();
  clearSessionCookie(c);
  return c.body(null, 204);
});

authRoutes.post("/app-code", requireUser, async (c) => {
  if (c.var.session.kind !== "web") throw new ApiError(403, "forbidden");
  const code = newToken();
  const now = nowIso();
  const expiresAt = addSeconds(now, APP_CODE_SECONDS);
  await c.env.DB.prepare(
    "INSERT INTO app_codes (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(await sha256Hex(code), c.var.user.id, now, expiresAt)
    .run();
  return c.json(AppCodeResponse.parse({ code, expiresAt }), 201);
});

authRoutes.post("/app-token", authLimit, async (c) => {
  const body = await readJson(c, AppTokenBody);
  // One statement marks the code used, so two requests with the same code cannot both pass.
  const used = await c.env.DB.prepare(
    `UPDATE app_codes SET used_at = ?1
     WHERE code_hash = ?2 AND used_at IS NULL AND expires_at > ?1
     RETURNING user_id`,
  )
    .bind(nowIso(), await sha256Hex(body.code))
    .first<{ user_id: string }>();
  if (used === null) throw new ApiError(400, "code_invalid");

  const row = await findUserById(c.env.DB, used.user_id);
  if (row === null) throw new Error("app-token: the code's user does not exist");
  const session = await newSession(c, row.id, "app", body.installationId);
  await session.insert.run();
  log(c.get("rid"), "app_session_created", { user: row.id });
  return c.json(AppTokenResponse.parse({ token: session.token, user: userFromRow(row) }), 201);
});

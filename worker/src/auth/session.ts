// Sessions: the web cookie mozol_session and the app bearer token (docs/product/accounts.md).
// loadSession runs for every /api/* request; requireUser guards the routes that need a user.
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { User } from "shared";
import { type UserRow, userFromRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { newId } from "../ids";
import { addDays, addSeconds, nowIso } from "../time";
import { newToken, sha256Hex } from "./tokens";

export const SESSION_COOKIE = "mozol_session";
const SESSION_DAYS = { web: 30, app: 365 } as const;
const EXTEND_AFTER_SECONDS = 3600;

export type SessionKind = keyof typeof SESSION_DAYS;
export type Session = { id: string; kind: SessionKind };
export type Auth = { user: User; session: Session };

type SessionUserRow = UserRow & {
  session_id: string;
  session_last_used_at: string;
  session_expires_at: string;
};

// A cookie is looked up as a web session, a bearer token as an app session.
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("auth", null);
  if (c.req.path.startsWith("/api/hooks/")) return next();

  const bearer = bearerToken(c.req.header("Authorization"));
  const cookie = bearer === undefined ? getCookie(c, SESSION_COOKIE) : undefined;
  if (cookie !== undefined && c.req.method !== "GET" && c.req.header("Origin") !== c.env.APP_ORIGIN) {
    throw new ApiError(403, "forbidden");
  }
  const token = bearer ?? cookie;
  if (token === undefined) return next();
  const kind: SessionKind = bearer === undefined ? "web" : "app";

  const now = nowIso();
  const row = await c.env.DB.prepare(
    `SELECT u.*, s.id AS session_id, s.last_used_at AS session_last_used_at, s.expires_at AS session_expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.kind = ?`,
  )
    .bind(await sha256Hex(token), kind)
    .first<SessionUserRow>();
  if (row === null || row.session_expires_at <= now) return next();

  // At most one write per session and hour.
  const extend = row.session_last_used_at <= addSeconds(now, -EXTEND_AFTER_SECONDS);
  if (extend) {
    await c.env.DB.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?")
      .bind(now, addDays(now, SESSION_DAYS[kind]), row.session_id)
      .run();
  }
  c.set("auth", { user: userFromRow(row), session: { id: row.session_id, kind } });
  await next();

  // The cookie lives as long as the session: 30 days from the last use.
  if (extend && kind === "web" && !setsSessionCookie(c.res)) setSessionCookie(c, token);
};

export const requireUser: MiddlewareHandler<AppEnv & { Variables: Auth }> = async (c, next) => {
  const auth = c.get("auth");
  if (auth === null) throw new ApiError(401, "unauthorized");
  c.set("user", auth.user);
  c.set("session", auth.session);
  await next();
};

// The insert of a new session, to run alone or in a batch. Only the token's hash is stored.
export async function newSession(
  c: Context<AppEnv>,
  userId: string,
  kind: SessionKind,
  installationId: string | null,
): Promise<{ token: string; insert: D1PreparedStatement }> {
  const token = newToken();
  const now = nowIso();
  const insert = c.env.DB.prepare(
    `INSERT INTO sessions
       (id, user_id, token_hash, kind, installation_id, user_agent, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId("ses"),
    userId,
    await sha256Hex(token),
    kind,
    installationId,
    c.req.header("User-Agent")?.slice(0, 300) ?? null,
    now,
    now,
    addDays(now, SESSION_DAYS[kind]),
  );
  return { token, insert };
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS.web * 86_400,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
}

function setsSessionCookie(res: Response): boolean {
  return res.headers.getSetCookie().some((v) => v.startsWith(`${SESSION_COOKIE}=`));
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1];
}

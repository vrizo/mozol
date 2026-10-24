import { env } from "cloudflare:workers";
import { AppCodeResponse, AppTokenResponse, UserResponse } from "shared";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/tokens";
import { newId } from "../src/ids";
import { addDays, addSeconds, nowIso } from "../src/time";
import {
  appCode,
  appToken,
  call,
  expectError,
  PASSWORD,
  randomIp,
  sessionCookie,
  signUp,
  signUpBody,
} from "./helpers";

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  kind: string;
  installation_id: string | null;
  user_agent: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
};

async function sessionOf(token: string): Promise<SessionRow | null> {
  return env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first<SessionRow>();
}

async function count(table: string, userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`)
    .bind(userId)
    .first<{ n: number }>();
  if (!row) throw new Error(`count: no row from ${table}`);
  return row.n;
}

// Seconds between two ISO times.
function secondsBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 1000;
}

function expectSessionCookie(res: Response, maxAge: number): void {
  const header = res.headers.getSetCookie().find((v) => v.startsWith("mozol_session="));
  expect(header).toBeDefined();
  const attributes = (header ?? "").split("; ").slice(1).sort();
  expect(attributes).toEqual(["HttpOnly", `Max-Age=${maxAge}`, "Path=/", "SameSite=Lax", "Secure"]);
}

const THIRTY_DAYS = 30 * 86_400;

describe("POST /api/auth/sign-up", () => {
  it("creates the user with defaults, a web session and the cookie", async () => {
    const name = `New.User.${crypto.randomUUID().slice(0, 8)}`;
    const body = signUpBody({ email: `${name}@Example.COM`, displayName: "Petr S." });
    const res = await call("/api/auth/sign-up", { body });

    expect(res.status).toBe(201);
    const { user } = UserResponse.parse(await res.json());
    expect(user).toMatchObject({
      email: `${name.toLowerCase()}@example.com`,
      displayName: "Petr S.",
      nativeLanguage: "ru",
      speakerNames: ["Petr S."],
      reminderSettings: {
        embedInMyReminders: true,
        intensity: "normal",
        activeFrom: "09:00",
        activeTo: "21:00",
      },
    });
    expect(user.id).toMatch(/^usr_/);
    expectSessionCookie(res, THIRTY_DAYS);

    const session = await sessionOf(sessionCookie(res));
    expect(session).toMatchObject({ user_id: user.id, kind: "web", installation_id: null });
  });

  it("stores only hashes of the password and the session token", async () => {
    const body = signUpBody();
    const res = await call("/api/auth/sign-up", { body });
    const token = sessionCookie(res);
    const { user } = UserResponse.parse(await res.json());

    const stored = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ password_hash: string }>();
    expect(stored?.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(stored?.password_hash).not.toContain(PASSWORD);

    const session = await sessionOf(token);
    expect(session?.token_hash).toBe(await sha256Hex(token));
    expect(session?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.values(session ?? {})).not.toContain(token);
  });

  it("answers 409 email_taken for an email that has an account, in any case", async () => {
    const { email } = await signUp();
    const res = await call("/api/auth/sign-up", { body: signUpBody({ email: email.toUpperCase() }) });
    await expectError(res, 409, "email_taken");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it.each([
    ["email", { email: "not-an-email" }],
    ["password", { password: "short" }],
    ["displayName", { displayName: "" }],
    ["nativeLanguage", { nativeLanguage: "RU" }],
  ])("answers 400 validation_failed for a bad %s", async (path, overrides) => {
    const res = await call("/api/auth/sign-up", { body: signUpBody(overrides) });
    const body = await expectError(res, 400, "validation_failed");
    expect(body.issues?.map((i) => i.path)).toEqual([path]);
  });

  it("answers 400 bad_json for a body that is not JSON", async () => {
    await expectError(await call("/api/auth/sign-up", { rawBody: "{nope" }), 400, "bad_json");
  });
});

describe("POST /api/auth/sign-in", () => {
  it("signs in with any case of the email and sets the cookie", async () => {
    const { user, email } = await signUp();
    const res = await call("/api/auth/sign-in", { body: { email: email.toUpperCase(), password: PASSWORD } });

    expect(res.status).toBe(200);
    expect(UserResponse.parse(await res.json())).toEqual({ user });
    expectSessionCookie(res, THIRTY_DAYS);
    expect((await sessionOf(sessionCookie(res)))?.kind).toBe("web");
  });

  it("answers 401 invalid_credentials for a wrong password and for an unknown email", async () => {
    const { email } = await signUp();
    for (const body of [
      { email, password: "wrong password" },
      { email: "nobody@example.com", password: PASSWORD },
    ]) {
      const res = await call("/api/auth/sign-in", { body });
      await expectError(res, 401, "invalid_credentials");
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });
});

describe("sessions", () => {
  it("GET /api/me works with the cookie and with the bearer token", async () => {
    const { user, cookie } = await signUp();
    const token = await appToken(cookie);

    for (const res of [await call("/api/me", { cookie }), await call("/api/me", { bearer: token })]) {
      expect(res.status).toBe(200);
      expect(UserResponse.parse(await res.json())).toEqual({ user });
    }
  });

  it("answers 401 unauthorized without a session, for an unknown token, and for a malformed header", async () => {
    await expectError(await call("/api/me"), 401, "unauthorized");
    await expectError(await call("/api/me", { cookie: "unknown" }), 401, "unauthorized");
    await expectError(await call("/api/me", { bearer: "unknown" }), 401, "unauthorized");
    for (const authorization of ["Basic dXNlcjpwYXNz", "Bearer", "Bearer a b"]) {
      const res = await call("/api/me", { headers: { Authorization: authorization } });
      await expectError(res, 401, "unauthorized");
    }
  });

  it("answers 401 for an expired session", async () => {
    const { cookie } = await signUp();
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
      .bind(addSeconds(nowIso(), -1), await sha256Hex(cookie))
      .run();
    await expectError(await call("/api/me", { cookie }), 401, "unauthorized");
  });

  it("accepts a web token only as the cookie and an app token only as the bearer token", async () => {
    const { cookie } = await signUp();
    const token = await appToken(cookie);
    await expectError(await call("/api/me", { bearer: cookie }), 401, "unauthorized");
    await expectError(await call("/api/me", { cookie: token }), 401, "unauthorized");
  });

  it("extends a web session after an hour and sends the cookie again", async () => {
    const { cookie } = await signUp();
    const old = addSeconds(nowIso(), -3601);
    await env.DB.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?")
      .bind(old, addDays(old, 1), await sha256Hex(cookie))
      .run();

    const res = await call("/api/me", { cookie });
    expect(res.status).toBe(200);
    expectSessionCookie(res, THIRTY_DAYS);
    expect(sessionCookie(res)).toBe(cookie);
    const session = await sessionOf(cookie);
    expect(session?.last_used_at).not.toBe(old);
    expect(secondsBetween(session?.last_used_at ?? "", session?.expires_at ?? "")).toBe(THIRTY_DAYS);
  });

  it("extends an app session to 365 days, without a cookie", async () => {
    const { cookie } = await signUp();
    const token = await appToken(cookie);
    const old = addSeconds(nowIso(), -7200);
    await env.DB.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?")
      .bind(old, addDays(old, 1), await sha256Hex(token))
      .run();

    const res = await call("/api/me", { bearer: token });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    const session = await sessionOf(token);
    expect(secondsBetween(session?.last_used_at ?? "", session?.expires_at ?? "")).toBe(365 * 86_400);
  });

  it("does not write a session used less than an hour ago", async () => {
    const { cookie } = await signUp();
    const before = await sessionOf(cookie);
    const res = await call("/api/me", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await sessionOf(cookie)).toEqual(before);
  });
});

describe("the Origin check", () => {
  it("answers 403 forbidden to a cookie POST with a wrong or missing Origin", async () => {
    const { cookie } = await signUp();
    for (const origin of ["https://evil.example", "http://localhost:5190x", null]) {
      const res = await call("/api/auth/app-code", { method: "POST", cookie, origin });
      await expectError(res, 403, "forbidden");
    }
    const patch = await call("/api/me", {
      method: "PATCH",
      cookie,
      origin: null,
      body: { displayName: "X" },
    });
    await expectError(patch, 403, "forbidden");
  });

  it("checks the Origin even when the cookie holds no valid session", async () => {
    const res = await call("/api/auth/sign-in", {
      cookie: "stale",
      origin: null,
      body: { email: "a@b.c", password: "x" },
    });
    await expectError(res, 403, "forbidden");
  });

  it("skips GET requests, bearer requests and /api/hooks/*", async () => {
    const { cookie } = await signUp();
    expect((await call("/api/me", { cookie, origin: null })).status).toBe(200);

    const token = await appToken(cookie);
    const signOut = await call("/api/auth/sign-out", {
      method: "POST",
      bearer: token,
      origin: "https://evil.example",
    });
    expect(signOut.status).toBe(204);

    const hook = await call("/api/hooks/json/abc", { cookie, origin: null, body: {} });
    await expectError(hook, 404, "hook_not_found");
  });
});

describe("POST /api/auth/sign-out", () => {
  it("deletes the cookie session and clears the cookie", async () => {
    const { cookie } = await signUp();
    const res = await call("/api/auth/sign-out", { method: "POST", cookie });

    expect(res.status).toBe(204);
    expectSessionCookie(res, 0);
    expect(sessionCookie(res)).toBe("");
    expect(await sessionOf(cookie)).toBeNull();
    await expectError(await call("/api/me", { cookie }), 401, "unauthorized");
  });

  it("ends only the current session", async () => {
    const { cookie } = await signUp();
    const token = await appToken(cookie);
    expect((await call("/api/auth/sign-out", { method: "POST", bearer: token })).status).toBe(204);

    expect(await sessionOf(token)).toBeNull();
    expect((await call("/api/me", { cookie })).status).toBe(200);
  });

  it("answers 401 unauthorized without a session", async () => {
    await expectError(await call("/api/auth/sign-out", { method: "POST" }), 401, "unauthorized");
  });
});

describe("POST /api/auth/app-code and /api/auth/app-token", () => {
  it("makes a 2-minute code and stores only its hash", async () => {
    const { user, cookie } = await signUp();
    const res = await call("/api/auth/app-code", { method: "POST", cookie });

    expect(res.status).toBe(201);
    const { code, expiresAt } = AppCodeResponse.parse(await res.json());
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await env.DB.prepare("SELECT * FROM app_codes WHERE user_id = ?")
      .bind(user.id)
      .first<{ code_hash: string; created_at: string; expires_at: string; used_at: string | null }>();
    expect(row).toMatchObject({ code_hash: await sha256Hex(code), expires_at: expiresAt, used_at: null });
    expect(secondsBetween(row?.created_at ?? "", expiresAt)).toBe(120);
  });

  it("answers 403 forbidden to an app session and 401 without a session", async () => {
    const { cookie } = await signUp();
    const token = await appToken(cookie);
    await expectError(await call("/api/auth/app-code", { method: "POST", bearer: token }), 403, "forbidden");
    await expectError(await call("/api/auth/app-code", { method: "POST" }), 401, "unauthorized");
  });

  it("exchanges a code for an app session once", async () => {
    const { user, cookie } = await signUp();
    const { code } = await appCode(cookie);
    const body = { code, installationId: "3F2504E0-4F89-11D3-9A0C-0305E82C3301" };

    const res = await call("/api/auth/app-token", { body });
    expect(res.status).toBe(201);
    const answer = AppTokenResponse.parse(await res.json());
    expect(answer.user).toEqual(user);
    expect(res.headers.getSetCookie()).toEqual([]);
    const session = await sessionOf(answer.token);
    expect(session).toMatchObject({ user_id: user.id, kind: "app", installation_id: body.installationId });
    expect(secondsBetween(session?.created_at ?? "", session?.expires_at ?? "")).toBe(365 * 86_400);
    const used = await env.DB.prepare("SELECT used_at FROM app_codes WHERE code_hash = ?")
      .bind(await sha256Hex(code))
      .first<{ used_at: string | null }>();
    expect(used?.used_at).not.toBeNull();

    await expectError(await call("/api/auth/app-token", { body }), 400, "code_invalid");
  });

  it("answers 400 code_invalid for an expired or unknown code", async () => {
    const { cookie } = await signUp();
    const { code } = await appCode(cookie);
    await env.DB.prepare("UPDATE app_codes SET expires_at = ? WHERE code_hash = ?")
      .bind(nowIso(), await sha256Hex(code))
      .run();
    for (const c of [code, "unknown-code"]) {
      const res = await call("/api/auth/app-token", { body: { code: c, installationId: "install-0001" } });
      await expectError(res, 400, "code_invalid");
    }
  });

  it("answers 400 validation_failed for a bad installationId", async () => {
    const { cookie } = await signUp();
    const { code } = await appCode(cookie);
    for (const installationId of ["short", "has spaces in it", "x".repeat(65)]) {
      const res = await call("/api/auth/app-token", { body: { code, installationId } });
      const body = await expectError(res, 400, "validation_failed");
      expect(body.issues?.map((i) => i.path)).toEqual(["installationId"]);
    }
  });
});

describe("PATCH /api/me", () => {
  it("changes the given fields and keeps the others", async () => {
    const { user, cookie } = await signUp();
    const change = {
      displayName: "Petr Shardakov",
      nativeLanguage: "uk",
      speakerNames: ["Petr", "Petr S."],
      reminderSettings: {
        embedInMyReminders: false,
        intensity: "intense",
        activeFrom: "07:30",
        activeTo: "23:59",
      },
    };
    const res = await call("/api/me", { method: "PATCH", cookie, body: change });

    expect(res.status).toBe(200);
    const expected = { ...user, ...change };
    expect(UserResponse.parse(await res.json())).toEqual({ user: expected });
    expect(UserResponse.parse(await (await call("/api/me", { cookie })).json())).toEqual({ user: expected });

    const one = await call("/api/me", { method: "PATCH", cookie, body: { displayName: "P" } });
    expect(UserResponse.parse(await one.json())).toEqual({ user: { ...expected, displayName: "P" } });
  });

  it("answers the unchanged user for an empty body", async () => {
    const { user, cookie } = await signUp();
    const res = await call("/api/me", { method: "PATCH", cookie, body: {} });
    expect(UserResponse.parse(await res.json())).toEqual({ user });
  });

  const settings = { embedInMyReminders: true, intensity: "normal", activeFrom: "09:00", activeTo: "21:00" };
  it.each([
    ["nativeLanguage", { nativeLanguage: "english" }],
    ["nativeLanguage", { nativeLanguage: "EN" }],
    ["displayName", { displayName: "x".repeat(81) }],
    ["speakerNames", { speakerNames: Array.from({ length: 11 }, (_, i) => `Name ${i}`) }],
    ["speakerNames.0", { speakerNames: [""] }],
    ["reminderSettings.activeFrom", { reminderSettings: { ...settings, activeFrom: "9:00" } }],
    ["reminderSettings.activeTo", { reminderSettings: { ...settings, activeTo: "24:00" } }],
    [
      "reminderSettings.activeTo",
      { reminderSettings: { ...settings, activeFrom: "21:00", activeTo: "09:00" } },
    ],
    ["reminderSettings.intensity", { reminderSettings: { ...settings, intensity: "max" } }],
    [
      "reminderSettings.embedInMyReminders",
      { reminderSettings: { activeFrom: "09:00", activeTo: "21:00", intensity: "normal" } },
    ],
    ["", { email: "other@example.com" }],
  ])("answers 400 validation_failed at %s", async (path, body) => {
    const { user, cookie } = await signUp();
    const res = await call("/api/me", { method: "PATCH", cookie, body });
    const error = await expectError(res, 400, "validation_failed");
    expect(error.issues?.map((i) => i.path)).toEqual([path]);
    expect(UserResponse.parse(await (await call("/api/me", { cookie })).json())).toEqual({ user });
  });
});

describe("DELETE /api/me", () => {
  it("answers 401 invalid_credentials for a wrong password and keeps the account", async () => {
    const { user, cookie } = await signUp();
    const res = await call("/api/me", { method: "DELETE", cookie, body: { password: "wrong password" } });
    await expectError(res, 401, "invalid_credentials");
    expect(await count("sessions", user.id)).toBe(1);
    expect((await call("/api/me", { cookie })).status).toBe(200);
  });

  it("deletes the user and every row of the user, and clears the cookie", async () => {
    const { user, cookie } = await signUp();
    const other = await signUp();
    await appToken(cookie);
    await appCode(cookie);
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO devices (id, user_id, installation_id, platform, bundle_id, reminders_access,
         last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, 'ios', 'net.vrizo.mozol', 'full', ?, ?, ?)`,
    )
      .bind(newId("dev"), user.id, `install-${user.id}`, now, now, now)
      .run();
    expect(await count("sessions", user.id)).toBe(2);
    expect(await count("app_codes", user.id)).toBe(2);

    const res = await call("/api/me", { method: "DELETE", cookie, body: { password: PASSWORD } });

    expect(res.status).toBe(204);
    expectSessionCookie(res, 0);
    const gone = await env.DB.prepare("SELECT count(*) AS n FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ n: number }>();
    expect(gone?.n).toBe(0);
    for (const table of ["sessions", "app_codes", "devices"])
      expect(await count(table, user.id), table).toBe(0);
    expect(await count("sessions", other.user.id)).toBe(1);
    await expectError(await call("/api/me", { cookie }), 401, "unauthorized");
  });
});

describe("the auth rate limit", () => {
  it("allows 10 requests per minute per IP across sign-up, sign-in and app-token, then answers 429", async () => {
    const ip = randomIp();
    const signIn = { email: "nobody@example.com", password: PASSWORD };
    for (let i = 0; i < 4; i++) {
      await expectError(await call("/api/auth/sign-in", { ip, body: signIn }), 401, "invalid_credentials");
    }
    for (let i = 0; i < 3; i++) {
      await expectError(
        await call("/api/auth/sign-up", { ip, body: { email: "x" } }),
        400,
        "validation_failed",
      );
    }
    for (let i = 0; i < 3; i++) {
      const body = { code: "unknown", installationId: "install-0001" };
      await expectError(await call("/api/auth/app-token", { ip, body }), 400, "code_invalid");
    }

    for (const path of ["/api/auth/sign-in", "/api/auth/sign-up", "/api/auth/app-token"]) {
      const res = await call(path, { ip, body: signIn });
      await expectError(res, 429, "rate_limited");
      expect(res.headers.get("Retry-After")).toBe("60");
    }
    await expectError(await call("/api/auth/sign-in", { body: signIn }), 401, "invalid_credentials");
  });

  it("does not limit the routes of a signed-in user", async () => {
    const ip = randomIp();
    const { cookie } = await signUp();
    for (let i = 0; i < 12; i++) expect((await call("/api/me", { ip, cookie })).status).toBe(200);
  });

  it("fails loudly with 500 internal when CF-Connecting-IP is missing", async () => {
    await expectError(
      await call("/api/auth/sign-in", { ip: null, body: { email: "a@b.c", password: "x" } }),
      500,
      "internal",
    );
  });
});

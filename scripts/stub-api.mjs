#!/usr/bin/env node
//
// stub-api.mjs — stands in for the worker. Implements, in memory, the parts of
// shared/CONTRACT.md that the iOS app uses, plus stub-only test routes.
//
// Contract routes ("auth" = Authorization: Bearer <app session token>, else 401 unauthorized):
//
//   GET    /api/health                              {"ok":true}
//   GET    /app/signin?return=mozol://...           HTML sign-in page for the in-app web view
//   POST   /api/auth/app-token                      { code, installationId } → 201 { token, user }
//   GET    /api/me                         auth     { user }
//   POST   /api/auth/sign-out              auth     204, ends that token
//   PUT    /api/devices/:installationId    auth     PutDeviceBody → { device }
//   GET    /api/devices                    auth     { devices }
//   DELETE /api/devices/:installationId    auth     204
//   POST   /api/devices/:installationId/test-push   auth  202 { ok: true }; logs only, nothing is pushed
//   POST   /api/deliveries/claim           auth     { installationId, limit? } → { deliveries, leaseSeconds, embedInMyReminders }
//   POST   /api/deliveries/results         auth     { installationId, results } → { accepted }
//
// Stub-only routes (no auth):
//
//   POST   /stub/app-code     { email }  → 201 { code, expiresAt }. Stands in for the web session
//                            plus POST /api/auth/app-code. Creates the user on first use of an email.
//   POST   /stub/deliveries   { email?, items? } → 201 { deliveryIds }. Queues deliveries for an
//                            existing user (email default learner@example.com). Without items: the two
//                            recommendations of shared/fixtures/deliveries/claim-response.json.
//                            items: [{ recommendation }]. recommendation needs language, kind,
//                            itemKey, title, notes, embedLine; id, url, marker, priority (5) and
//                            matchTerms ([]) are filled in when missing.
//   POST   /stub/settings     { email?, embedInMyReminders } → { user }
//   GET    /stub/state        users, devices and deliveries with their status
//
// The stub sends no pushes: after queueing deliveries, run scripts/sim-push.sh.
// One JSON log line per request on stdout, rid first. Port: MOZOL_WORKER_PORT or 8790.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.MOZOL_WORKER_PORT ?? 8790);
const FIXTURE_URL = new URL("../shared/fixtures/deliveries/claim-response.json", import.meta.url);
const DEFAULT_EMAIL = "learner@example.com";
const LEASE_SECONDS = 120;
const CODE_TTL_MS = 2 * 60 * 1000;
const MAX_FAILURES = 3;
const INSTALLATION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const APNS_TOKEN = /^[0-9a-f]{64,200}$/;
const REMINDERS_ACCESS = ["full", "write_only", "denied", "restricted", "not_determined"];
const APPLIED_OUTCOMES = ["embed_updated", "reminder_updated", "embedded", "created"];
const KINDS = ["mistake", "word"];
const DEVICE_KEYS = [
  "platform", "bundleId", "appVersion", "osVersion",
  "apnsToken", "apnsEnvironment", "remindersAccess",
];

const usersByEmail = new Map();
const sessions = new Map();        // token → userId
const appCodes = new Map();        // code → { userId, expiresAt }
const devices = new Map();         // installationId → device record
const deliveries = [];             // oldest first

const log = (fields) => console.log(JSON.stringify(fields));

class Reply {
  constructor(status, body) {
    this.status = status;
    this.body = body;
  }
}

const fail = (status, error, extra) => new Reply(status, { error, ...extra });
const invalid = (issues) => fail(400, "validation_failed", { issues });
const nowIso = () => new Date().toISOString();
const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");

function newId(prefix) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return `${prefix}_${[...randomBytes(26)].map((b) => alphabet[b % 32]).join("")}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Parses the body as a JSON object. allowEmpty: an empty body counts as {} (stub-only routes).
async function readObject(req, { allowEmpty = false } = {}) {
  const text = await readBody(req);
  if (allowEmpty && text.trim() === "") return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw fail(400, "bad_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid([{ path: "", code: "invalid_type" }]);
  }
  return value;
}

// Pushes an issue when value is not a string of min..max characters (or null when nullable).
function checkText(issues, path, value, min, max, nullable = false) {
  if (value === null && nullable) return;
  if (typeof value !== "string") issues.push({ path, code: "invalid_type" });
  else if (value.length < min) issues.push({ path, code: "too_small" });
  else if (value.length > max) issues.push({ path, code: "too_big" });
}

function checkEnum(issues, path, value, allowed) {
  if (!allowed.includes(value)) issues.push({ path, code: "invalid_value" });
}

function checkInstallationId(issues, path, value) {
  if (typeof value !== "string") issues.push({ path, code: "invalid_type" });
  else if (!INSTALLATION_ID.test(value)) issues.push({ path, code: "invalid_format" });
}

function publicUser(user) {
  const { id, email, displayName, nativeLanguage, speakerNames, reminderSettings, createdAt } = user;
  return { id, email, displayName, nativeLanguage, speakerNames, reminderSettings, createdAt };
}

function publicDevice(device) {
  const { id, installationId, platform, appVersion, osVersion, remindersAccess, lastSeenAt } = device;
  return {
    id, installationId, platform, appVersion, osVersion,
    pushEnabled: device.apnsToken !== null,
    remindersAccess, lastSeenAt,
  };
}

function userFor(email) {
  const existing = usersByEmail.get(email);
  if (existing) return existing;
  const displayName = email.split("@")[0].slice(0, 80);
  const user = {
    id: newId("usr"),
    email,
    displayName,
    nativeLanguage: "ru",
    speakerNames: [displayName],
    reminderSettings: { embedInMyReminders: true },
    createdAt: nowIso(),
  };
  usersByEmail.set(email, user);
  return user;
}

function existingUser(email) {
  const user = usersByEmail.get(email);
  if (!user) {
    throw fail(404, "not_found", { detail: `no user with email ${email}; sign in through /app/signin or POST /stub/app-code first` });
  }
  return user;
}

function emailFrom(body) {
  if (body.email === undefined) return DEFAULT_EMAIL;
  if (typeof body.email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(body.email)) {
    throw invalid([{ path: "email", code: "invalid_format" }]);
  }
  return body.email.toLowerCase();
}

function requireUser(ctx) {
  const match = /^Bearer (\S+)$/.exec(ctx.req.headers.authorization ?? "");
  const userId = match ? sessions.get(match[1]) : undefined;
  if (!userId) throw fail(401, "unauthorized");
  const user = [...usersByEmail.values()].find((u) => u.id === userId);
  if (!user) throw new Error(`session points at missing user ${userId}`);
  return { user, token: match[1] };
}

function requireDevice(user, installationId) {
  const device = devices.get(installationId);
  if (!device || device.userId !== user.id) throw fail(404, "not_found");
  return device;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function signinPage(ret) {
  const head = "<!doctype html><html lang=en><meta charset=utf-8>" +
    "<meta name=viewport content='width=device-width, initial-scale=1'><title>MOZOL sign-in</title>" +
    "<style>body{font:17px -apple-system,system-ui,sans-serif;margin:24px}input,button{font:inherit;width:100%;padding:12px;margin:8px 0;box-sizing:border-box}</style>";
  if (typeof ret !== "string" || !ret.startsWith("mozol://")) {
    return [400, `${head}<h1>Sign-in error</h1><p role=alert>The return address must start with mozol://. Got: ${escapeHtml(String(ret))}</p>`, "text/html; charset=utf-8"];
  }
  const retJs = JSON.stringify(ret).replace(/</g, "\\u003c");
  return [200, `${head}<h1>Sign in to MOZOL</h1>
<form id=form>
<label for=email>Email</label>
<input id=email name=email type=email autocomplete=email value="${DEFAULT_EMAIL}" required>
<button id=submit type=submit>Sign In</button>
</form>
<p id=error role=alert></p>
<script>
document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("error");
  error.textContent = "";
  try {
    const res = await fetch("/stub/app-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: document.getElementById("email").value }),
    });
    const body = await res.json();
    if (res.status !== 201) throw new Error("app-code answered " + res.status + " " + JSON.stringify(body));
    location.href = ${retJs} + "?code=" + encodeURIComponent(body.code);
  } catch (e) {
    error.textContent = "Sign-in failed: " + e.message;
  }
});
</script>`, "text/html; charset=utf-8"];
}

function checkRecommendation(issues, rec, path) {
  checkText(issues, `${path}.language`, rec.language, 2, 3);
  checkEnum(issues, `${path}.kind`, rec.kind, KINDS);
  checkText(issues, `${path}.itemKey`, rec.itemKey, 1, 200);
  checkText(issues, `${path}.title`, rec.title, 1, 500);
  checkText(issues, `${path}.notes`, rec.notes, 0, 10000);
  checkText(issues, `${path}.embedLine`, rec.embedLine, 1, 200);
  if (rec.id !== undefined) checkText(issues, `${path}.id`, rec.id, 1, 100);
  if (rec.url !== undefined) checkText(issues, `${path}.url`, rec.url, 1, 2000);
  if (rec.marker !== undefined && !/^[0-9a-f]{8}$/.test(rec.marker)) issues.push({ path: `${path}.marker`, code: "invalid_format" });
  if (rec.priority !== undefined) checkEnum(issues, `${path}.priority`, rec.priority, [1, 5]);
  if (rec.matchTerms !== undefined && !Array.isArray(rec.matchTerms)) issues.push({ path: `${path}.matchTerms`, code: "invalid_type" });
}

function fixtureRecommendations() {
  let text;
  try {
    text = readFileSync(FIXTURE_URL, "utf8");
  } catch (error) {
    throw new Error(`cannot read the delivery fixture ${FIXTURE_URL.pathname}: ${error.message}`);
  }
  const items = JSON.parse(text).deliveries;
  if (!Array.isArray(items) || items.length === 0) throw new Error(`no deliveries in ${FIXTURE_URL.pathname}`);
  return items.map((item) => ({ recommendation: item.recommendation }));
}

function publicDelivery(d) {
  return { deliveryId: d.id, recommendation: d.recommendation };
}

// Handlers. Each returns [status, body, contentType?] or throws a Reply.

const handlers = {
  health: () => [200, { ok: true }],

  signin: (ctx) => signinPage(ctx.url.searchParams.get("return")),

  async stubAppCode(ctx) {
    const body = await readObject(ctx.req);
    if (typeof body.email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(body.email)) {
      throw invalid([{ path: "email", code: "invalid_format" }]);
    }
    const user = userFor(body.email.toLowerCase());
    const code = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    appCodes.set(code, { userId: user.id, expiresAt });
    return [201, { code, expiresAt }];
  },

  async appToken(ctx) {
    const body = await readObject(ctx.req);
    const issues = [];
    if (typeof body.code !== "string") issues.push({ path: "code", code: "invalid_type" });
    checkInstallationId(issues, "installationId", body.installationId);
    if (issues.length) throw invalid(issues);
    const entry = appCodes.get(body.code);
    appCodes.delete(body.code);
    if (!entry || Date.parse(entry.expiresAt) <= Date.now()) throw fail(400, "code_invalid");
    const user = [...usersByEmail.values()].find((u) => u.id === entry.userId);
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, user.id);
    return [201, { token, user: publicUser(user) }];
  },

  me(ctx) {
    const { user } = requireUser(ctx);
    return [200, { user: publicUser(user) }];
  },

  signOut(ctx) {
    const { token } = requireUser(ctx);
    sessions.delete(token);
    return [204, null];
  },

  async putDevice(ctx) {
    const { user } = requireUser(ctx);
    const installationId = ctx.params[0];
    const body = await readObject(ctx.req);
    const issues = [];
    checkInstallationId(issues, "installationId", installationId);
    const unknown = Object.keys(body).filter((k) => !DEVICE_KEYS.includes(k));
    if (unknown.length) issues.push({ path: "", code: "unrecognized_keys", keys: unknown });
    checkEnum(issues, "platform", body.platform, ["ios"]);
    checkText(issues, "bundleId", body.bundleId, 1, 200);
    checkText(issues, "appVersion", body.appVersion, 1, 50, true);
    checkText(issues, "osVersion", body.osVersion, 1, 50, true);
    const tokenOk = body.apnsToken === null || (typeof body.apnsToken === "string" && APNS_TOKEN.test(body.apnsToken));
    if (!tokenOk) issues.push({ path: "apnsToken", code: typeof body.apnsToken === "string" ? "invalid_format" : "invalid_type" });
    const envOk = ["sandbox", "production", null].includes(body.apnsEnvironment);
    if (!envOk) issues.push({ path: "apnsEnvironment", code: "invalid_value" });
    if (tokenOk && envOk && (body.apnsToken === null) !== (body.apnsEnvironment === null)) {
      issues.push({ path: "apnsEnvironment", code: "custom", message: "null exactly when apnsToken is null" });
    }
    checkEnum(issues, "remindersAccess", body.remindersAccess, REMINDERS_ACCESS);
    if (issues.length) throw invalid(issues);

    const previous = devices.get(installationId);
    if (previous && previous.userId !== user.id) {
      log({ rid: ctx.rid, event: "device moved to another user", installationId, from: previous.userId, to: user.id });
    }
    const device = {
      id: previous?.id ?? newId("dev"),
      installationId,
      userId: user.id,
      ...Object.fromEntries(DEVICE_KEYS.map((k) => [k, body[k]])),
      lastSeenAt: nowIso(),
      createdAt: previous?.createdAt ?? nowIso(),
    };
    devices.set(installationId, device);
    return [200, { device: publicDevice(device) }];
  },

  listDevices(ctx) {
    const { user } = requireUser(ctx);
    return [200, { devices: [...devices.values()].filter((d) => d.userId === user.id).map(publicDevice) }];
  },

  deleteDevice(ctx) {
    const { user } = requireUser(ctx);
    const device = requireDevice(user, ctx.params[0]);
    devices.delete(device.installationId);
    return [204, null];
  },

  testPush(ctx) {
    const { user } = requireUser(ctx);
    const device = requireDevice(user, ctx.params[0]);
    log({
      rid: ctx.rid, event: "test-push not sent: the stub cannot push",
      installationId: device.installationId,
      hint: `scripts/sim-push.sh '{"mozol":{"v":1,"type":"test"}}'`,
    });
    return [202, { ok: true }];
  },

  async claim(ctx) {
    const { user } = requireUser(ctx);
    const body = await readObject(ctx.req);
    const issues = [];
    checkInstallationId(issues, "installationId", body.installationId);
    const limit = body.limit ?? 20;
    if (!Number.isInteger(limit)) issues.push({ path: "limit", code: "invalid_type" });
    else if (limit < 1) issues.push({ path: "limit", code: "too_small" });
    else if (limit > 50) issues.push({ path: "limit", code: "too_big" });
    if (issues.length) throw invalid(issues);
    const device = requireDevice(user, body.installationId);

    const now = Date.now();
    const live = (d) => d.status === "claimed" && d.leaseUntil > now;
    const heldMarkers = new Set(deliveries.filter((d) => d.userId === user.id && live(d)).map((d) => d.recommendation.marker));
    const picked = [];
    const markers = new Set();
    for (const d of deliveries) {
      if (picked.length >= limit) break;
      if (d.userId !== user.id) continue;
      if (d.status !== "pending" && !(d.status === "claimed" && !live(d))) continue;
      const marker = d.recommendation.marker;
      if (markers.has(marker) || heldMarkers.has(marker)) continue;
      markers.add(marker);
      picked.push(d);
    }
    const leaseUntil = now + LEASE_SECONDS * 1000;
    for (const d of picked) {
      Object.assign(d, { status: "claimed", claimedBy: device.installationId, leaseUntil, updatedAt: nowIso() });
    }
    device.lastSeenAt = nowIso();
    return [200, {
      deliveries: picked.map(publicDelivery),
      leaseSeconds: LEASE_SECONDS,
      embedInMyReminders: user.reminderSettings.embedInMyReminders,
    }];
  },

  async results(ctx) {
    const { user } = requireUser(ctx);
    const body = await readObject(ctx.req);
    const issues = [];
    checkInstallationId(issues, "installationId", body.installationId);
    if (!Array.isArray(body.results)) issues.push({ path: "results", code: "invalid_type" });
    else if (body.results.length < 1) issues.push({ path: "results", code: "too_small" });
    else if (body.results.length > 50) issues.push({ path: "results", code: "too_big" });
    else {
      body.results.forEach((r, i) => {
        if (!r || typeof r !== "object") return issues.push({ path: `results.${i}`, code: "invalid_type" });
        checkText(issues, `results.${i}.deliveryId`, r.deliveryId, 1, 100);
        checkEnum(issues, `results.${i}.outcome`, r.outcome, [...APPLIED_OUTCOMES, "failed"]);
        if (r.errorCode !== undefined) checkText(issues, `results.${i}.errorCode`, r.errorCode, 1, 64);
      });
    }
    if (issues.length) throw invalid(issues);
    const device = requireDevice(user, body.installationId);

    let accepted = 0;
    for (const r of body.results) {
      const d = deliveries.find((x) => x.id === r.deliveryId);
      if (!d || d.userId !== user.id || d.status !== "claimed" || d.claimedBy !== device.installationId) continue;
      accepted += 1;
      if (r.outcome === "failed") {
        d.failures += 1;
        Object.assign(d, { status: d.failures >= MAX_FAILURES ? "failed" : "pending", errorCode: r.errorCode ?? null });
      } else {
        Object.assign(d, { status: "applied", outcome: r.outcome, errorCode: null });
      }
      Object.assign(d, { claimedBy: d.status === "pending" ? null : d.claimedBy, leaseUntil: null, updatedAt: nowIso() });
    }
    device.lastSeenAt = nowIso();
    return [200, { accepted }];
  },

  async stubDeliveries(ctx) {
    const body = await readObject(ctx.req, { allowEmpty: true });
    const user = existingUser(emailFrom(body));
    if (body.items !== undefined && (!Array.isArray(body.items) || body.items.length === 0)) {
      throw invalid([{ path: "items", code: "invalid_type" }]);
    }
    const items = body.items ?? fixtureRecommendations();
    const issues = [];
    items.forEach((item, i) => {
      if (!item || typeof item !== "object" || !item.recommendation || typeof item.recommendation !== "object") {
        return issues.push({ path: `items.${i}.recommendation`, code: "invalid_type" });
      }
      checkRecommendation(issues, item.recommendation, `items.${i}.recommendation`);
    });
    if (issues.length) throw invalid(issues);

    const ids = items.map((item) => {
      const rec = item.recommendation;
      const id = rec.id ?? newId("rec");
      const delivery = {
        id: newId("dlv"),
        userId: user.id,
        recommendation: {
          id,
          language: rec.language,
          kind: rec.kind,
          itemKey: rec.itemKey,
          marker: rec.marker ?? sha256Hex(`${rec.language}:${rec.itemKey}`).slice(0, 8),
          title: rec.title,
          notes: rec.notes,
          embedLine: rec.embedLine,
          matchTerms: rec.matchTerms ?? [],
          url: rec.url ?? `${ctx.origin}/r/${id}`,
          priority: rec.priority ?? 5,
        },
        status: "pending",
        outcome: null,
        errorCode: null,
        failures: 0,
        claimedBy: null,
        leaseUntil: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      deliveries.push(delivery);
      return delivery.id;
    });
    log({ rid: ctx.rid, event: "deliveries queued", count: ids.length, hint: "push with scripts/sim-push.sh" });
    return [201, { deliveryIds: ids }];
  },

  async stubSettings(ctx) {
    const body = await readObject(ctx.req);
    const user = existingUser(emailFrom(body));
    if (typeof body.embedInMyReminders !== "boolean") throw invalid([{ path: "embedInMyReminders", code: "invalid_type" }]);
    user.reminderSettings = { ...user.reminderSettings, embedInMyReminders: body.embedInMyReminders };
    return [200, { user: publicUser(user) }];
  },

  stubState() {
    const emailOf = (userId) => [...usersByEmail.values()].find((u) => u.id === userId)?.email ?? null;
    return [200, {
      users: [...usersByEmail.values()].map(publicUser),
      devices: [...devices.values()].map((d) => ({
        ...publicDevice(d), userEmail: emailOf(d.userId), bundleId: d.bundleId,
        apnsToken: d.apnsToken, apnsEnvironment: d.apnsEnvironment,
      })),
      deliveries: deliveries.map((d) => ({
        id: d.id, userEmail: emailOf(d.userId), recommendationId: d.recommendation.id,
        marker: d.recommendation.marker, itemKey: d.recommendation.itemKey, status: d.status,
        outcome: d.outcome, errorCode: d.errorCode, failures: d.failures, claimedBy: d.claimedBy,
        leaseUntil: d.leaseUntil === null ? null : new Date(d.leaseUntil).toISOString(), updatedAt: d.updatedAt,
      })),
    }];
  },
};

const DEVICE_PATH = /^\/api\/devices\/([^/]+)$/;
const routes = [
  ["GET", /^\/api\/health$/, handlers.health],
  ["GET", /^\/app\/signin$/, handlers.signin],
  ["POST", /^\/api\/auth\/app-token$/, handlers.appToken],
  ["POST", /^\/api\/auth\/sign-out$/, handlers.signOut],
  ["GET", /^\/api\/me$/, handlers.me],
  ["GET", /^\/api\/devices$/, handlers.listDevices],
  ["PUT", DEVICE_PATH, handlers.putDevice],
  ["DELETE", DEVICE_PATH, handlers.deleteDevice],
  ["POST", /^\/api\/devices\/([^/]+)\/test-push$/, handlers.testPush],
  ["POST", /^\/api\/deliveries\/claim$/, handlers.claim],
  ["POST", /^\/api\/deliveries\/results$/, handlers.results],
  ["POST", /^\/stub\/app-code$/, handlers.stubAppCode],
  ["POST", /^\/stub\/deliveries$/, handlers.stubDeliveries],
  ["POST", /^\/stub\/settings$/, handlers.stubSettings],
  ["GET", /^\/stub\/state$/, handlers.stubState],
];

async function route(ctx) {
  for (const [method, pattern, handler] of routes) {
    const match = pattern.exec(ctx.url.pathname);
    if (method === ctx.req.method && match) {
      try {
        ctx.params = match.slice(1).map(decodeURIComponent);
      } catch {
        throw fail(404, "not_found");
      }
      return handler(ctx);
    }
  }
  return [404, { error: "not_found" }];
}

createServer(async (req, res) => {
  const started = Date.now();
  const rid = req.headers["x-request-id"] ?? randomBytes(6).toString("hex");
  const origin = `http://${req.headers.host ?? `localhost:${port}`}`;
  const url = new URL(req.url, origin);
  let status = 500;
  try {
    let result;
    try {
      result = await route({ req, url, rid, origin, params: [] });
    } catch (thrown) {
      if (!(thrown instanceof Reply)) throw thrown;
      result = [thrown.status, thrown.body];
    }
    const [code, body, type] = result;
    status = code;
    if (code === 204) {
      res.writeHead(204, { "X-Request-Id": rid });
      res.end();
    } else {
      res.writeHead(code, { "Content-Type": type ?? "application/json", "X-Request-Id": rid });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    }
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json", "X-Request-Id": rid });
    res.end(JSON.stringify({ error: "internal" }));
    log({ rid, level: "error", error: String(error?.stack ?? error) });
  }
  log({ rid, method: req.method, path: url.pathname, status, ms: Date.now() - started });
}).listen(port, () => log({ rid: "-", event: "stub-api listening", port }));

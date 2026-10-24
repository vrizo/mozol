#!/usr/bin/env node
//
// stub-api.mjs — stands in for the worker until it exists. Implements the
// placeholder routes of shared/CONTRACT.md in memory, plus test-only routes:
//
//   GET  /api/health                 {"ok":true}
//   GET  /api/messages?after=<id>    queued messages after the cursor (Bearer token required)
//   POST /api/devices                stores the APNs token (Bearer token required)
//   GET  /signup                     a plain HTML page for the in-app web view
//   POST /stub/messages              queue one message; body is any JSON object, the stub adds "id"
//   GET  /stub/state                 queued messages and registered devices
//
// One JSON log line per request on stdout, rid first. Port: MOZOL_WORKER_PORT or 8790.

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.MOZOL_WORKER_PORT ?? 8790);
const messages = [];
const devices = new Map();
let seq = 0;

const log = (fields) => console.log(JSON.stringify(fields));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function route(req, url) {
  const key = `${req.method} ${url.pathname}`;
  const authorized = /^Bearer \S+$/.test(req.headers.authorization ?? "");

  switch (key) {
    case "GET /api/health":
      return [200, { ok: true }];

    case "GET /api/messages": {
      if (!authorized) return [401, { error: "unauthorized" }];
      const after = url.searchParams.get("after");
      const start = after ? messages.findIndex((m) => m.id === after) + 1 : 0;
      const page = messages.slice(start);
      return [200, { messages: page, cursor: page.length ? page[page.length - 1].id : null }];
    }

    case "POST /api/devices": {
      if (!authorized) return [401, { error: "unauthorized" }];
      const body = parseObject(await readBody(req));
      if (!body || !/^[0-9a-f]{16,}$/.test(body.token ?? "") || body.platform !== "ios") {
        return [400, { error: "invalid_body" }];
      }
      devices.set(body.token, { environment: body.environment, at: new Date().toISOString() });
      return [200, { ok: true }];
    }

    case "GET /signup":
      return [200, "<!doctype html><meta name=viewport content='width=device-width'><title>MOZOL</title><h1>Sign up</h1><p>Stub page from scripts/stub-api.mjs.</p>", "text/html"];

    case "POST /stub/messages": {
      const body = parseObject(await readBody(req));
      if (!body) return [400, { error: "body_must_be_a_json_object" }];
      seq += 1;
      const message = { ...body, id: `s${seq}` };
      messages.push(message);
      return [200, message];
    }

    case "GET /stub/state":
      return [200, { messages, devices: Object.fromEntries(devices) }];

    default:
      return [404, { error: "not_found" }];
  }
}

createServer(async (req, res) => {
  const started = Date.now();
  const rid = req.headers["x-request-id"] ?? randomBytes(6).toString("hex");
  const url = new URL(req.url, `http://localhost:${port}`);
  let status = 500;
  try {
    const [code, body, type] = await route(req, url);
    status = code;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(code, { "Content-Type": type ?? "application/json", "X-Request-Id": rid });
    res.end(text);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json", "X-Request-Id": rid });
    res.end(JSON.stringify({ error: "stub_crashed" }));
    log({ rid, level: "error", error: String(error) });
  }
  log({ rid, method: req.method, path: url.pathname, status, ms: Date.now() - started });
}).listen(port, () => log({ rid: "-", event: "stub-api listening", port }));

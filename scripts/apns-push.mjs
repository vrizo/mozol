#!/usr/bin/env node
//
// apns-push.mjs — send a silent push to one device through APNs, with the
// team key from .env (APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY_BASE64).
//
//   scripts/apns-push.mjs <device token> ['{"word":"hola"}'] [--sandbox]
//
// The JSON object's keys go next to "aps": {"content-available": 1}.
// TestFlight and App Store builds use production APNs (default); Debug builds
// from Xcode on a device use --sandbox. Rules: docs/ios/push-testing.md.

import { createPrivateKey, createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:http2";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOPIC = "net.vrizo.mozol";
const fail = (message) => {
  console.error(`[apns-push] ERROR: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const sandbox = args.includes("--sandbox");
const [token, data = `{"stub":"${new Date().toISOString()}"}`] = args.filter((a) => a !== "--sandbox");
if (!/^[0-9a-f]{64,}$/.test(token ?? "")) fail("first argument must be the hex device token from the app's Settings.");

let extra;
try {
  extra = JSON.parse(data);
} catch {
  fail(`payload is not JSON: ${data}`);
}
if (!extra || typeof extra !== "object" || Array.isArray(extra)) fail("payload must be a JSON object.");
const payload = JSON.stringify({ aps: { "content-available": 1 }, ...extra });

const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
for (const key of ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY_BASE64"]) {
  if (!env[key]) fail(`${key} not set in .env.`);
}

const key = createPrivateKey(Buffer.from(env.APNS_PRIVATE_KEY_BASE64, "base64").toString("utf8"));
const part = (object) => Buffer.from(JSON.stringify(object)).toString("base64url");
const unsigned = `${part({ alg: "ES256", kid: env.APNS_KEY_ID })}.${part({ iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
const signature = createSign("SHA256").update(unsigned).sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url");

const host = sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
const apnsId = randomUUID();
const client = connect(host);
client.on("error", (error) => fail(`connection to ${host} failed: ${error.message}`));
const request = client.request({
  ":method": "POST",
  ":path": `/3/device/${token}`,
  authorization: `bearer ${unsigned}.${signature}`,
  "apns-topic": TOPIC,
  "apns-push-type": "background",
  "apns-priority": "5",
  "apns-id": apnsId,
  "content-type": "application/json",
});
let status = 0;
let body = "";
request.on("response", (headers) => {
  status = headers[":status"];
});
request.setEncoding("utf8");
request.on("data", (chunk) => {
  body += chunk;
});
request.on("end", () => {
  client.close();
  const where = sandbox ? "sandbox" : "production";
  if (status === 200) {
    console.log(`[apns-push] accepted by APNs ${where}: apns-id ${apnsId}, ${Buffer.byteLength(payload)} bytes`);
    return;
  }
  fail(`APNs ${where} answered ${status}: ${body || "(no body)"} apns-id ${apnsId}`);
});
request.end(payload);

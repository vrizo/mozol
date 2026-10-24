// The APNs provider token: an ES256 JWT shared by all worker instances through worker_state (docs/backend/push.md).
import { z } from "zod";
import { fromBase64, toBase64Url } from "../auth/bytes";
import { readJson, writeJson } from "../db/json";
import { nowIso } from "../time";
import type { ApnsKey } from "./config";

const STATE_KEY = "apns_token";
const MAX_AGE_SECONDS = 50 * 60;

const StoredToken = z.strictObject({
  keyId: z.string(),
  teamId: z.string(),
  issuedAt: z.number().int(),
  token: z.string(),
});
type StoredToken = z.infer<typeof StoredToken>;

// The stored token while it is younger than 50 minutes and made with the same key; otherwise a new one.
// fresh makes a new token in any case: APNs rejected the stored one.
export async function providerToken(
  db: D1Database,
  key: ApnsKey,
  options: { fresh?: boolean; nowMs?: number } = {},
): Promise<string> {
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (!options.fresh) {
    const row = await db
      .prepare("SELECT value FROM worker_state WHERE key = ?")
      .bind(STATE_KEY)
      .first<{ value: string }>();
    if (row !== null) {
      const stored = readJson(row.value, StoredToken, "worker_state.apns_token");
      const age = now - stored.issuedAt;
      if (stored.keyId === key.keyId && stored.teamId === key.teamId && age >= 0 && age < MAX_AGE_SECONDS) {
        return stored.token;
      }
    }
  }

  const stored: StoredToken = {
    keyId: key.keyId,
    teamId: key.teamId,
    issuedAt: now,
    token: await signToken(key, now),
  };
  await db
    .prepare(
      `INSERT INTO worker_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(STATE_KEY, writeJson(stored), nowIso())
    .run();
  return stored.token;
}

// WebCrypto ECDSA signatures are already the raw r||s form that JWS ES256 needs.
export async function signToken(key: ApnsKey, issuedAt: number): Promise<string> {
  const header = encodePart({ alg: "ES256", kid: key.keyId });
  const claims = encodePart({ iss: key.teamId, iat: issuedAt });
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importKey(key.privateKey),
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

async function importKey(base64: string): Promise<CryptoKey> {
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = fromBase64(base64);
  } catch {
    throw new Error("push: APNS_PRIVATE_KEY is not base64 (the .p8 body without the BEGIN and END lines)");
  }
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

function encodePart(value: object): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

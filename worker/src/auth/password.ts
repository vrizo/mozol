// Password hashes: PBKDF2-SHA256, stored as "pbkdf2-sha256$100000$<salt base64>$<hash base64>".
import { fromBase64, randomBytes, toBase64 } from "./bytes";

const SCHEME = "pbkdf2-sha256";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, ITERATIONS);
  return `${SCHEME}$${ITERATIONS}$${toBase64(salt)}$${toBase64(key)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { iterations, salt, key } = parseStored(stored);
  const given = await derive(password, salt, iterations);
  return crypto.subtle.timingSafeEqual(given, key);
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function parseStored(stored: string) {
  const parts = stored.split("$");
  const [scheme, iterations, salt, key] = parts;
  if (parts.length !== 4 || scheme !== SCHEME || iterations !== String(ITERATIONS) || !salt || !key) {
    throw new Error("password: the stored hash has an unknown format");
  }
  const keyBytes = fromBase64(key);
  if (keyBytes.length !== KEY_BYTES) throw new Error("password: the stored hash has a wrong length");
  return { iterations: ITERATIONS, salt: fromBase64(salt), key: keyBytes };
}

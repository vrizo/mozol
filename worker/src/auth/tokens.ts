// Session tokens and app sign-in codes: 32 random bytes in base64url. The database keeps only the SHA-256 hex.
import { randomBytes, toBase64Url, toHex } from "./bytes";

export function newToken(): string {
  return toBase64Url(randomBytes(32));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

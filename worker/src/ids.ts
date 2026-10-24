// Row ids: "<prefix>_<ULID>" (docs/backend/data-model.md). A ULID is 10 characters of time and 16 of randomness.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_TIME = 2 ** 48 - 1;

export type IdPrefix =
  | "usr"
  | "ses"
  | "dev"
  | "con"
  | "evt"
  | "trn"
  | "ana"
  | "fnd"
  | "wsg"
  | "pat"
  | "wrd"
  | "rec"
  | "dlv"
  | "psh";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid(Date.now())}`;
}

export function ulid(timeMs: number): string {
  return encodeTime(timeMs) + encodeRandom(crypto.getRandomValues(new Uint8Array(10)));
}

function encodeTime(timeMs: number): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > MAX_TIME) {
    throw new Error(`ulid: time out of range: ${timeMs}`);
  }
  let rest = timeMs;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD.charAt((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { newToken, sha256Hex } from "../src/auth/tokens";

describe("password hashes", () => {
  it("are stored as pbkdf2-sha256$100000$<16-byte salt>$<32-byte key> in base64", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
  });

  it("verify the right password and refuse a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
  });

  it("use a new salt every time", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it.each([
    "bcrypt$10$abc",
    "pbkdf2-sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAA",
  ])("refuse to verify against the unknown stored format %s", async (stored) => {
    await expect(verifyPassword("anything", stored)).rejects.toThrow(/password: the stored hash/);
  });
});

describe("tokens", () => {
  it("are 32 random bytes in base64url", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
  });

  it("are hashed with SHA-256 into 64 hex characters", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

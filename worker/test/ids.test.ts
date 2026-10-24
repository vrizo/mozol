import { afterEach, describe, expect, it, vi } from "vitest";
import { newId, ulid } from "../src/ids";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

afterEach(() => {
  vi.useRealTimers();
});

describe("newId", () => {
  it("makes '<prefix>_<ULID>' with a 26-character ULID", () => {
    const id = newId("usr");
    expect(id).toMatch(/^usr_/);
    expect(id.slice(4)).toMatch(ULID);
  });

  it("makes ids that sort by time", () => {
    vi.useFakeTimers();
    const ids = ["2026-10-24T12:00:00.000Z", "2026-10-24T12:00:00.001Z", "2026-10-25T00:00:00.000Z"].map(
      (t) => {
        vi.setSystemTime(new Date(t));
        return newId("trn");
      },
    );
    expect([...ids].sort()).toEqual(ids);
  });

  it("does not repeat within one millisecond", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId("evt")));
    expect(ids.size).toBe(1000);
  });
});

describe("ulid", () => {
  it("encodes the time in the first 10 characters (example from the ULID spec)", () => {
    expect(ulid(1469918176385).slice(0, 10)).toBe("01ARYZ6S41");
    expect(ulid(0).slice(0, 10)).toBe("0000000000");
    expect(ulid(2 ** 48 - 1).slice(0, 10)).toBe("7ZZZZZZZZZ");
  });

  it("sorts by time, also across a change in the higher characters", () => {
    const times = [0, 1, 31, 32, 1023, 1024, 1792843200000, 1792843200001, 2 ** 48 - 1];
    const ids = times.map(ulid);
    for (const id of ids) expect(id).toMatch(ULID);
    expect([...ids].sort()).toEqual(ids);
  });

  it("refuses a time outside 0..2^48-1", () => {
    expect(() => ulid(-1)).toThrow(/time out of range/);
    expect(() => ulid(2 ** 48)).toThrow(/time out of range/);
    expect(() => ulid(1.5)).toThrow(/time out of range/);
  });
});

import { describe, expect, it } from "vitest";
import { addDays, addSeconds, nowIso } from "../src/time";

describe("time", () => {
  it("nowIso is ISO 8601 UTC with milliseconds", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("addSeconds crosses the day boundary and goes back with a negative value", () => {
    expect(addSeconds("2026-10-24T23:59:30.000Z", 120)).toBe("2026-10-25T00:01:30.000Z");
    expect(addSeconds("2026-10-24T12:00:00.000Z", -0.5)).toBe("2026-10-24T11:59:59.500Z");
  });

  it("addDays adds whole UTC days, unaffected by daylight saving changes", () => {
    expect(addDays("2026-10-24T12:00:00.000Z", 7)).toBe("2026-10-31T12:00:00.000Z");
    expect(addDays("2026-03-01T00:00:00.000Z", -1)).toBe("2026-02-28T00:00:00.000Z");
  });

  it.each([
    "2026-10-24",
    "2026-10-24T12:00:00Z",
    "2026-10-24T12:00:00.000+02:00",
    "2026-13-01T00:00:00.000Z",
    "",
  ])("refuses %j", (iso) => {
    expect(() => addSeconds(iso, 1)).toThrow(/not an ISO UTC time/);
  });
});

import { describe, expect, it } from "vitest";
import { safeNext } from "../router";
import { fieldErrors, isAppReturn, withCode } from "./auth";

describe("isAppReturn", () => {
  it("accepts mozol:// addresses", () => {
    expect(isAppReturn("mozol://auth")).toBe(true);
  });

  it.each(["https://x", "javascript:alert(1)", "mozol:/x", "", null])("refuses %s", (value) => {
    expect(isAppReturn(value)).toBe(false);
  });
});

describe("withCode", () => {
  it("adds the code to an address without a query", () => {
    expect(withCode("mozol://auth", "a-b_c")).toBe("mozol://auth?code=a-b_c");
  });

  it("adds the code to an address with a query", () => {
    expect(withCode("mozol://auth?x=1", "abc")).toBe("mozol://auth?x=1&code=abc");
  });
});

describe("safeNext", () => {
  it("keeps a same-site path", () => {
    expect(safeNext("/activity?x=1")).toBe("/activity?x=1");
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "activity", "", null])("refuses %s", (value) => {
    expect(safeNext(value)).toBe("/activity");
  });
});

describe("fieldErrors", () => {
  it("maps the first issue of each top-level field", () => {
    expect(
      fieldErrors([
        { path: "email", code: "invalid_format" },
        { path: "email", code: "too_big" },
        { path: "reminderSettings.activeTo", code: "custom" },
      ]),
    ).toEqual({ email: "invalid_format", reminderSettings: "custom" });
  });
});

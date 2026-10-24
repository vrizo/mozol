import { describe, expect, it } from "vitest";
import { matchPath } from "./router";

describe("matchPath", () => {
  it.each([
    ["/", "home", {}],
    ["/signup", "signup", {}],
    ["/signin", "signin", {}],
    ["/app/signin", "appSignin", {}],
    ["/activity", "activity", {}],
    ["/activity/trn_1", "transcript", { id: "trn_1" }],
    ["/patterns", "patterns", {}],
    ["/words", "words", {}],
    ["/sources", "sources", {}],
    ["/sources/paste", "paste", {}],
    ["/sources/con_1", "connection", { id: "con_1" }],
    ["/r/rec_1", "recommendation", { id: "rec_1" }],
    ["/recommendations", "recommendations", {}],
    ["/profile", "profile", {}],
  ])("%s is %s", (path, name, params) => {
    expect(matchPath(path)).toEqual({ name, params });
  });

  it("matches /sources/paste before /sources/:id", () => {
    expect(matchPath("/sources/paste").name).toBe("paste");
  });

  it("decodes parameters", () => {
    expect(matchPath("/activity/a%20b").params).toEqual({ id: "a b" });
  });

  it("ignores a trailing slash", () => {
    expect(matchPath("/activity/")).toEqual({ name: "activity", params: {} });
    expect(matchPath("/activity/trn_1/").params).toEqual({ id: "trn_1" });
  });

  it.each(["/nope", "/activity/trn_1/extra", "/app", "/r", "/sources/paste/x"])("%s is not found", (path) => {
    expect(matchPath(path).name).toBe("notFound");
  });
});

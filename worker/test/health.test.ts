import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const RID = /^[0-9a-f]{12}$/;

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(new Request(`http://localhost${path}`, { headers }));
}

describe("GET /api/health", () => {
  it("answers 200 {ok:true}", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("echoes a valid X-Request-Id unchanged", async () => {
    const res = await get("/api/health", { "X-Request-Id": "0123456789ab" });
    expect(res.headers.get("X-Request-Id")).toBe("0123456789ab");
  });

  it("makes a new id when X-Request-Id is missing", async () => {
    const res = await get("/api/health");
    expect(res.headers.get("X-Request-Id")).toMatch(RID);
  });

  it.each(["0123456789AB", "0123456789a", "0123456789abc", "zzzzzzzzzzzz"])(
    "replaces the invalid X-Request-Id %s",
    async (given) => {
      const res = await get("/api/health", { "X-Request-Id": given });
      const rid = res.headers.get("X-Request-Id");
      expect(rid).toMatch(RID);
      expect(rid).not.toBe(given);
    },
  );
});

describe("unknown /api/* paths", () => {
  it("answers 404 not_found", async () => {
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(res.headers.get("X-Request-Id")).toMatch(RID);
  });
});

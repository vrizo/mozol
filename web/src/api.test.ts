import { HealthResponse } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, buildUrl, request, requestId } from "./api";

function fakeFetch(status: number, body: unknown) {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requestId", () => {
  it("is 12 lowercase hex characters, new each time", () => {
    const ids = new Set(Array.from({ length: 50 }, requestId));
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(ids.size).toBe(50);
  });
});

describe("buildUrl", () => {
  it("returns the path without a query", () => {
    expect(buildUrl("/api/me")).toBe("/api/me");
    expect(buildUrl("/api/me", {})).toBe("/api/me");
  });

  it("adds defined values and encodes them", () => {
    expect(buildUrl("/api/words", { status: "new", language: undefined, limit: 20, delivered: false })).toBe(
      "/api/words?status=new&limit=20&delivered=false",
    );
    expect(buildUrl("/api/transcripts", { cursor: "a b&c" })).toBe("/api/transcripts?cursor=a+b%26c");
  });
});

describe("request", () => {
  it("sends JSON with a request id and parses the answer", async () => {
    const fetch = fakeFetch(200, { ok: true });
    await expect(request("POST", "/api/health", { body: { a: 1 }, schema: HealthResponse })).resolves.toEqual(
      {
        ok: true,
      },
    );
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("/api/health");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe('{"a":1}');
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Request-Id"]).toMatch(/^[0-9a-f]{12}$/);
  });

  it("turns an error body into ApiError with code, issues and rid", async () => {
    const fetch = fakeFetch(400, {
      error: "validation_failed",
      issues: [{ path: "email", code: "invalid_format" }],
    });
    const error = await request("POST", "/api/auth/sign-up", { body: {}, schema: HealthResponse }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: "validation_failed",
      issues: [{ path: "email", code: "invalid_format" }],
    });
    const headers = (fetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(error.rid).toBe(headers["X-Request-Id"]);
  });

  it("names the status when the error body is not a contract error", async () => {
    fakeFetch(502, { message: "bad gateway" });
    await expect(request("GET", "/api/me")).rejects.toMatchObject({
      status: 502,
      code: "http_502",
      issues: [],
    });
  });

  it("throws bad_response when the answer does not match the schema", async () => {
    fakeFetch(200, { ok: "yes" });
    await expect(request("GET", "/api/health", { schema: HealthResponse })).rejects.toMatchObject({
      status: 200,
      code: "bad_response",
    });
  });

  it("returns nothing for a request without a schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(request("POST", "/api/auth/sign-out")).resolves.toBeUndefined();
  });
});

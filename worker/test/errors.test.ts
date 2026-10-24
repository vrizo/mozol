import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AppEnv } from "../src/env";
import { ApiError, onError, readJson } from "../src/errors";
import { requestId } from "../src/request-id";

const Body = z.object({ email: z.email(), profile: z.object({ age: z.number() }) });

const app = new Hono<AppEnv>();
app.use(requestId);
app.onError(onError);
app.post("/body", async (c) => c.json(await readJson(c, Body)));
app.get("/api-error", () => {
  throw new ApiError(409, "email_taken");
});
app.get("/crash", () => {
  throw new Error("boom");
});
app.get("/internal-zod", () => parseOwnData());

function parseOwnData(): Response {
  z.object({ ok: z.literal(true) }).parse({ ok: false });
  return new Response();
}

function post(body: string): Response | Promise<Response> {
  return app.request("/body", { method: "POST", body, headers: { "Content-Type": "application/json" } });
}

describe("onError", () => {
  it("answers an ApiError with its status and code", async () => {
    const res = await app.request("/api-error");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "email_taken" });
  });

  it("answers broken JSON with 400 bad_json", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_json" });
  });

  it("answers a body that fails its schema with 400 validation_failed and issues", async () => {
    const res = await post(JSON.stringify({ email: "nope", profile: { age: "x" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "validation_failed",
      issues: [
        { path: "email", code: "invalid_format" },
        { path: "profile.age", code: "invalid_type" },
      ],
    });
  });

  it("answers a valid body", async () => {
    const res = await post(JSON.stringify({ email: "a@b.co", profile: { age: 3 } }));
    expect(res.status).toBe(200);
  });

  it("answers any other error, also a zod error outside request input, with 500 internal", async () => {
    for (const path of ["/crash", "/internal-zod"]) {
      const res = await app.request(path);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
    }
  });
});

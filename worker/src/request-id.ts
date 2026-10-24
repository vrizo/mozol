// Takes a valid X-Request-Id or makes one, echoes it, and logs one "req" line per request.
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { AppEnv } from "./env";
import { log } from "./log";

const RID = /^[0-9a-f]{12}$/;

export function newRid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = Date.now();
  const given = c.req.header("X-Request-Id");
  const rid = given !== undefined && RID.test(given) ? given : newRid();
  c.set("rid", rid);
  await next();
  c.header("X-Request-Id", rid);
  log(rid, "req", {
    method: c.req.method,
    route: routePath(c),
    status: c.res.status,
    ms: Date.now() - started,
  });
};

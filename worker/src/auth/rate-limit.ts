// AUTH_LIMITER (wrangler.jsonc): 10 requests per 60 seconds per client IP, for sign-up, sign-in and app-token.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

export const authLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ip = c.req.header("CF-Connecting-IP");
  if (!ip) throw new Error("rate limit: the request has no CF-Connecting-IP header");
  const { success } = await c.env.AUTH_LIMITER.limit({ key: ip });
  if (!success) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  await next();
};

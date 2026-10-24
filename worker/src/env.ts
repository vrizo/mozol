// Bindings, variables and secrets of the worker (wrangler.jsonc, worker/.dev.vars, wrangler secret put).
import type { Auth } from "./auth/session";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_LIMITER: RateLimit;
  APP_ORIGIN: string;
  ANALYSIS_MODE: string;
  ANALYSIS_MODEL: string;
  ANALYSIS_EFFORT: string;
  PUSH_MODE: string;
  ANTHROPIC_API_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_PRIVATE_KEY?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { rid: string; auth: Auth | null };
};

// Push configuration from the worker variables and secrets (docs/backend/push.md, Configuration).
import type { Env } from "../env";

export type ApnsKey = { keyId: string; teamId: string; privateKey: string };

// apns: null in apns mode means the APNs secrets are not set.
export type PushConfig = { mode: "log" } | { mode: "apns"; apns: ApnsKey | null };

export function pushConfig(env: Env): PushConfig {
  if (env.PUSH_MODE === "log") return { mode: "log" };
  if (env.PUSH_MODE !== "apns")
    throw new Error(`push: unknown PUSH_MODE "${env.PUSH_MODE}", expected apns or log`);
  const { APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_PRIVATE_KEY: privateKey } = env;
  if (!keyId || !teamId || !privateKey) return { mode: "apns", apns: null };
  return { mode: "apns", apns: { keyId, teamId, privateKey } };
}

export class PushNotConfiguredError extends Error {
  constructor() {
    super("push: PUSH_MODE is apns but APNS_KEY_ID, APNS_TEAM_ID or APNS_PRIVATE_KEY is not set");
    this.name = "PushNotConfiguredError";
  }
}

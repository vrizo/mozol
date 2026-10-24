// APNs payloads the worker sends. Every push is a silent background push. Custom keys sit next to `aps` under `mozol`.
import { z } from "zod";

const SilentAps = z.strictObject({ "content-available": z.literal(1) });

export const DeliveriesPush = z.strictObject({
  aps: SilentAps,
  mozol: z.strictObject({ v: z.literal(1), type: z.literal("deliveries"), pending: z.number().int().min(1) }),
});
export type DeliveriesPush = z.infer<typeof DeliveriesPush>;

export const TestPush = z.strictObject({
  aps: SilentAps,
  mozol: z.strictObject({ v: z.literal(1), type: z.literal("test") }),
});
export type TestPush = z.infer<typeof TestPush>;

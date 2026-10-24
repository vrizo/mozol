// APNs payloads the worker sends. Custom keys sit next to `aps` under `mozol`.
import { z } from "zod";
import { Id } from "./common";

const AlertAps = z.strictObject({
  alert: z.strictObject({ title: z.string().min(1), body: z.string().min(1) }),
  sound: z.literal("default"),
  "mutable-content": z.literal(1),
  "thread-id": z.literal("mozol"),
});

// transcriptId is null for "send to phone".
export const AlertPush = z.strictObject({
  aps: AlertAps,
  mozol: z.strictObject({
    v: z.literal(1),
    type: z.literal("deliveries"),
    pending: z.number().int().min(1),
    transcriptId: Id.nullable(),
  }),
});
export type AlertPush = z.infer<typeof AlertPush>;

export const BackgroundPush = z.strictObject({
  aps: z.strictObject({ "content-available": z.literal(1) }),
  mozol: z.strictObject({ v: z.literal(1), type: z.literal("deliveries"), pending: z.number().int().min(1) }),
});
export type BackgroundPush = z.infer<typeof BackgroundPush>;

export const TestPush = z.strictObject({
  aps: AlertAps,
  mozol: z.strictObject({ v: z.literal(1), type: z.literal("test") }),
});
export type TestPush = z.infer<typeof TestPush>;

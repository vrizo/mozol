// The silent pushes and their APNs headers (shared/CONTRACT.md, "Push notifications").
import { DeliveriesPush, TestPush } from "shared";

export const MAX_PAYLOAD_BYTES = 4096;
const EXPIRATION_SECONDS = 3600;

export type PushPayload = DeliveriesPush | TestPush;
export type PushHeaders = Record<string, string>;

export function deliveriesPayload(pending: number): DeliveriesPush {
  return checkSize(
    DeliveriesPush.parse({ aps: { "content-available": 1 }, mozol: { v: 1, type: "deliveries", pending } }),
  );
}

export function testPayload(): TestPush {
  return checkSize(TestPush.parse({ aps: { "content-available": 1 }, mozol: { v: 1, type: "test" } }));
}

export function pushHeaders(bundleId: string, nowMs = Date.now()): PushHeaders {
  return {
    "apns-push-type": "background",
    "apns-priority": "5",
    "apns-topic": bundleId,
    "apns-expiration": String(Math.floor(nowMs / 1000) + EXPIRATION_SECONDS),
  };
}

function checkSize<T extends PushPayload>(payload: T): T {
  const size = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (size > MAX_PAYLOAD_BYTES)
    throw new Error(`push: payload of ${size} bytes is over ${MAX_PAYLOAD_BYTES}`);
  return payload;
}

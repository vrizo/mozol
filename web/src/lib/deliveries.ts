// The newest delivery of a recommendation in plain words, and whether it can be sent to the phone again.
import type { Delivery } from "shared";
import { copy } from "../copy/en";

const t = copy.recommendations;
const labels = copy.labels;

export type DeliveryState = "not_sent" | "waiting" | "applied" | "failed" | "superseded";

export function deliveryState(delivery: Delivery | null): DeliveryState {
  if (!delivery) return "not_sent";
  if (delivery.status === "pending" || delivery.status === "claimed") return "waiting";
  return delivery.status;
}

// The delivery state and outcome in plain words.
export function deliveryText(delivery: Delivery | null): string {
  const state = deliveryState(delivery);
  if (!delivery || state === "not_sent") return labels.deliveryState.notSent;
  if (state === "waiting") return labels.deliveryState.waiting;
  if (state === "superseded") return t.state.superseded;
  if (state === "failed") return labels.deliveryState.failed(delivery.errorCode);
  if (!delivery.outcome) throw new Error(`applied delivery ${delivery.id} has no outcome`);
  return t.state.applied(labels.deliveryOutcome[delivery.outcome]);
}

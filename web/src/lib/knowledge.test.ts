import type { Delivery } from "shared";
import { describe, expect, it } from "vitest";
import { copy } from "../copy/en";
import { deliveryState, deliveryText } from "./deliveries";
import { filterByLanguage, languagesOf, matchModeLabel, pickStatus } from "./knowledge";

const delivery = (fields: Partial<Delivery>): Delivery => ({
  id: "dlv_1",
  status: "pending",
  outcome: null,
  errorCode: null,
  updatedAt: "2026-10-24T12:00:00.000Z",
  ...fields,
});

describe("delivery state", () => {
  it("maps statuses to states", () => {
    expect(deliveryState(null)).toBe("not_sent");
    expect(deliveryState(delivery({ status: "pending" }))).toBe("waiting");
    expect(deliveryState(delivery({ status: "claimed" }))).toBe("waiting");
    expect(deliveryState(delivery({ status: "applied", outcome: "created" }))).toBe("applied");
    expect(deliveryState(delivery({ status: "failed" }))).toBe("failed");
    expect(deliveryState(delivery({ status: "superseded" }))).toBe("superseded");
  });

  it("says the outcome in plain words", () => {
    const { deliveryState: s, deliveryOutcome: o } = copy.labels;
    const applied = copy.recommendations.state.applied;
    expect(deliveryText(null)).toBe(s.notSent);
    expect(deliveryText(delivery({ status: "claimed" }))).toBe(s.waiting);
    expect(deliveryText(delivery({ status: "applied", outcome: "embedded" }))).toBe(applied(o.embedded));
    expect(deliveryText(delivery({ status: "applied", outcome: "created" }))).toBe(applied(o.created));
    expect(deliveryText(delivery({ status: "failed", errorCode: "reminders_denied" }))).toBe(
      s.failed("reminders_denied"),
    );
  });

  it("throws for an applied delivery without an outcome", () => {
    expect(() => deliveryText(delivery({ status: "applied" }))).toThrow();
  });
});

describe("labels and filters", () => {
  it("labels every match term mode", () => {
    for (const mode of ["word", "prefix", "phrase", "substring"] as const) {
      expect(matchModeLabel(mode)).toBe(copy.recommendations.modes[mode]);
    }
  });

  it("lists distinct languages and filters by one", () => {
    const items = [{ language: "en" }, { language: "de" }, { language: "en" }];
    expect(languagesOf(items)).toEqual(["de", "en"]);
    expect(filterByLanguage(items, "en")).toHaveLength(2);
    expect(filterByLanguage(items, null)).toHaveLength(3);
  });

  it("picks a known status or the first one", () => {
    const allowed = ["active", "learned", "dismissed"] as const;
    expect(pickStatus("learned", allowed)).toBe("learned");
    expect(pickStatus("bogus", allowed)).toBe("active");
    expect(pickStatus(null, allowed)).toBe("active");
  });

  it("counts patterns in plain words", () => {
    expect(copy.patterns.counts(3, 2)).toMatch(/3.*2/);
    expect(copy.patterns.counts(1, 1)).not.toBe(copy.patterns.counts(2, 1));
  });
});

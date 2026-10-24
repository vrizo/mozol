// Recommendations, deliveries, and the claim and results endpoints of the app.
import { z } from "zod";
import { MatchTerm, PATTERN_KEY } from "./analysis";
import { Id, InstallationId, LanguageCode, PageQuery, paged, Time } from "./common";
import { normalizeText } from "./matching";

export const RecommendationKind = z.enum(["mistake", "word"]);
export type RecommendationKind = z.infer<typeof RecommendationKind>;

export const Marker = z.string().regex(/^[0-9a-f]{8}$/);

// The worker sends match terms normalized.
export const NormalizedMatchTerm = MatchTerm.refine((term) => term.text === normalizeText(term.text), {
  path: ["text"],
  message: "match term is not normalized",
});

// EventKit scale: 1 high, 5 medium.
export const Priority = z.union([z.literal(1), z.literal(5)]);

export const DeliveryStatus = z.enum(["pending", "claimed", "applied", "failed", "superseded"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const DeliveryOutcome = z.enum(["embed_updated", "reminder_updated", "embedded", "created"]);
export type DeliveryOutcome = z.infer<typeof DeliveryOutcome>;

export const Delivery = z.strictObject({
  id: Id,
  status: DeliveryStatus,
  outcome: DeliveryOutcome.nullable(),
  errorCode: z.string().nullable(),
  updatedAt: Time,
});
export type Delivery = z.infer<typeof Delivery>;

// Without the item key rule: DeliveryItem picks fields from it.
export const RecommendationObject = z.strictObject({
  id: Id,
  transcriptId: Id.nullable(),
  language: LanguageCode,
  kind: RecommendationKind,
  itemKey: z.string().min(1),
  marker: Marker,
  title: z.string().min(1),
  notes: z.string(),
  embedLine: z.string().min(1).max(200),
  matchTerms: z.array(NormalizedMatchTerm),
  url: z.url(),
  priority: Priority,
  delivery: Delivery.nullable(),
  createdAt: Time,
});

const ITEM_KEY: Record<RecommendationKind, RegExp> = {
  mistake: PATTERN_KEY,
  word: /^word:\S/,
};

function checkItemKey(rec: { kind: RecommendationKind; itemKey: string }, ctx: z.RefinementCtx): void {
  const fits = ITEM_KEY[rec.kind].test(rec.itemKey) && (rec.kind !== "mistake" || rec.itemKey.length <= 64);
  if (!fits) ctx.addIssue({ code: "custom", path: ["itemKey"], message: `not an item key of a ${rec.kind}` });
}

export const Recommendation = RecommendationObject.superRefine(checkItemKey);
export type Recommendation = z.infer<typeof Recommendation>;

export const RecommendationResponse = z.strictObject({ recommendation: Recommendation });
export type RecommendationResponse = z.infer<typeof RecommendationResponse>;

export const RecommendationsPage = paged(Recommendation);
export type RecommendationsPage = z.infer<typeof RecommendationsPage>;

export const RecommendationsQuery = PageQuery.extend({
  delivered: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
export type RecommendationsQuery = z.infer<typeof RecommendationsQuery>;

export const DeliveryItem = z.strictObject({
  deliveryId: Id,
  recommendation: RecommendationObject.pick({
    id: true,
    language: true,
    kind: true,
    itemKey: true,
    marker: true,
    title: true,
    notes: true,
    embedLine: true,
    matchTerms: true,
    url: true,
    priority: true,
  }).superRefine(checkItemKey),
});
export type DeliveryItem = z.infer<typeof DeliveryItem>;

export const ClaimBody = z.strictObject({
  installationId: InstallationId,
  limit: z.number().int().min(1).max(50).default(20),
});
export type ClaimBody = z.infer<typeof ClaimBody>;

export const ClaimResponse = z.strictObject({
  deliveries: z.array(DeliveryItem).max(50),
  leaseSeconds: z.literal(120),
  embedInMyReminders: z.boolean(),
});
export type ClaimResponse = z.infer<typeof ClaimResponse>;

export const DeliveryResult = z.strictObject({
  deliveryId: Id,
  outcome: z.union([DeliveryOutcome, z.literal("failed")]),
  errorCode: z.string().min(1).max(64).optional(),
});
export type DeliveryResult = z.infer<typeof DeliveryResult>;

export const ResultsBody = z.strictObject({
  installationId: InstallationId,
  results: z.array(DeliveryResult).min(1).max(50),
});
export type ResultsBody = z.infer<typeof ResultsBody>;

export const ResultsResponse = z.strictObject({ accepted: z.number().int().min(0) });
export type ResultsResponse = z.infer<typeof ResultsResponse>;

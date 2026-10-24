// The recommendations and deliveries tables and their mapping to the API Recommendation and DeliveryItem
// (shared/CONTRACT.md, "Recommendations"; docs/backend/data-model.md).
import { type DeliveryItem, NormalizedMatchTerm, Recommendation } from "shared";
import { z } from "zod";
import { readJson } from "./json";

export type RecommendationRow = {
  id: string;
  transcript_id: string | null;
  language: string;
  kind: string;
  item_key: string;
  marker: string;
  rank: number;
  title: string;
  notes: string;
  embed_line: string;
  match_terms: string;
  created_at: string;
  delivery: string | null;
};

// r.* with the newest delivery as JSON (null when it has none).
export const RECOMMENDATION_COLUMNS = `r.id, r.transcript_id, r.language, r.kind, r.item_key, r.marker, r.rank, r.title,
  r.notes, r.embed_line, r.match_terms, r.created_at,
  (SELECT json_object('id', d.id, 'status', d.status, 'outcome', d.outcome, 'errorCode', d.error_code,
     'updatedAt', d.updated_at)
   FROM deliveries d WHERE d.recommendation_id = r.id ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS delivery`;

const MatchTermsColumn = z.array(NormalizedMatchTerm);
const DeliveryColumn = z.strictObject({
  id: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  errorCode: z.string().nullable(),
  updatedAt: z.string(),
});

export function recommendationUrl(origin: string, id: string): string {
  return `${origin}/r/${id}`;
}

export function recommendationFromRow(row: RecommendationRow, origin: string): Recommendation {
  return Recommendation.parse({
    id: row.id,
    transcriptId: row.transcript_id,
    language: row.language,
    kind: row.kind,
    itemKey: row.item_key,
    marker: row.marker,
    title: row.title,
    notes: row.notes,
    embedLine: row.embed_line,
    matchTerms: readJson(row.match_terms, MatchTermsColumn, "recommendations.match_terms"),
    url: recommendationUrl(origin, row.id),
    delivery: row.delivery === null ? null : readJson(row.delivery, DeliveryColumn, "deliveries (newest)"),
    createdAt: row.created_at,
  });
}

export function deliveryItem(deliveryId: string, rec: Recommendation): DeliveryItem {
  return {
    deliveryId,
    recommendation: {
      id: rec.id,
      language: rec.language,
      kind: rec.kind,
      itemKey: rec.itemKey,
      marker: rec.marker,
      title: rec.title,
      notes: rec.notes,
      embedLine: rec.embedLine,
      matchTerms: rec.matchTerms,
      url: rec.url,
    },
  };
}

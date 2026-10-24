// /api/recommendations: the user's recommendations, newest first (shared/CONTRACT.md, "Endpoints:
// recommendations and deliveries").
import { Hono } from "hono";
import { RecommendationResponse, RecommendationsPage, RecommendationsQuery, Time } from "shared";
import { requireUser } from "../auth/session";
import { RECOMMENDATION_COLUMNS, type RecommendationRow, recommendationFromRow } from "../db/recommendations";
import type { AppEnv } from "../env";
import { ApiError, parseInput } from "../errors";

const RECOMMENDATION_ID = /^rec_[0-9A-HJKMNP-TV-Z]{26}$/;

export const recommendationRoutes = new Hono<AppEnv>();

// The cursor is "<createdAt>_<id>" of the last recommendation of the page before.
recommendationRoutes.get("/", requireUser, async (c) => {
  const query = parseInput(RecommendationsQuery, c.req.query());
  const after = query.cursor === undefined ? null : parseCursor(query.cursor);
  const delivered =
    query.delivered === undefined
      ? ""
      : `AND ${query.delivered ? "" : "NOT "}EXISTS (SELECT 1 FROM deliveries d WHERE d.recommendation_id = r.id)`;
  const page = after === null ? "" : "AND (r.created_at < ?3 OR (r.created_at = ?3 AND r.id < ?4))";
  const { results } = await c.env.DB.prepare(
    `SELECT ${RECOMMENDATION_COLUMNS} FROM recommendations r WHERE r.user_id = ?1 ${delivered} ${page}
     ORDER BY r.created_at DESC, r.id DESC LIMIT ?2`,
  )
    .bind(c.var.user.id, query.limit + 1, ...(after === null ? [] : [after.createdAt, after.id]))
    .all<RecommendationRow>();
  const items = results.slice(0, query.limit);
  const last = items.at(-1);
  const nextCursor = results.length > query.limit && last ? `${last.created_at}_${last.id}` : null;
  return c.json(
    RecommendationsPage.parse({
      items: items.map((row) => recommendationFromRow(row, c.env.APP_ORIGIN)),
      nextCursor,
    }),
  );
});

recommendationRoutes.get("/:id", requireUser, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT ${RECOMMENDATION_COLUMNS} FROM recommendations r WHERE r.id = ? AND r.user_id = ?`,
  )
    .bind(c.req.param("id"), c.var.user.id)
    .first<RecommendationRow>();
  if (row === null) throw new ApiError(404, "not_found");
  return c.json(
    RecommendationResponse.parse({ recommendation: recommendationFromRow(row, c.env.APP_ORIGIN) }),
  );
});

function parseCursor(cursor: string): { createdAt: string; id: string } {
  const split = cursor.indexOf("_");
  const createdAt = cursor.slice(0, split);
  const id = cursor.slice(split + 1);
  if (split < 0 || !Time.safeParse(createdAt).success || !RECOMMENDATION_ID.test(id)) {
    throw new ApiError(400, "validation_failed", [{ path: "cursor", code: "invalid_format" }]);
  }
  return { createdAt, id };
}

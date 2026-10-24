// /api/deliveries: the app claims waiting deliveries and reports their outcomes (shared/CONTRACT.md,
// "Endpoints: recommendations and deliveries"; docs/backend/pipeline.md, "Deliveries").
import { Hono } from "hono";
import { ClaimBody, ClaimResponse, ResultsBody, ResultsResponse } from "shared";
import { requireUser } from "../auth/session";
import { findDevice } from "../db/devices";
import {
  deliveryItem,
  RECOMMENDATION_COLUMNS,
  type RecommendationRow,
  recommendationFromRow,
} from "../db/recommendations";
import type { AppEnv } from "../env";
import { ApiError, readJson } from "../errors";
import { log } from "../log";
import { addSeconds, nowIso } from "../time";

const LEASE_SECONDS = 120;
const MAX_FAILURES = 3;

export const deliveryRoutes = new Hono<AppEnv>();

// One statement marks what it hands out, so two devices never get the same delivery: the user's pending
// deliveries and the claimed ones whose lease ended, oldest first, at most one per marker, none for a marker with
// a live claimed delivery. Deliveries made together go in the delivery order of their recommendations (rank).
deliveryRoutes.post("/claim", requireUser, async (c) => {
  const body = await readJson(c, ClaimBody);
  const user = c.var.user;
  const device = await findDevice(c.env.DB, user.id, body.installationId);
  if (device === null) throw new ApiError(404, "not_found");
  const now = nowIso();
  const { results: claimed } = await c.env.DB.prepare(
    `UPDATE deliveries SET status = 'claimed', claimed_by = ?1, claimed_until = ?2, updated_at = ?3
     WHERE id IN (
       SELECT id FROM (
         SELECT d.id, d.created_at, r.rank,
           ROW_NUMBER() OVER (PARTITION BY d.marker ORDER BY d.created_at, r.rank, d.id) AS n
         FROM deliveries d JOIN recommendations r ON r.id = d.recommendation_id
         WHERE d.user_id = ?4
           AND (d.status = 'pending' OR (d.status = 'claimed' AND d.claimed_until <= ?3))
           AND NOT EXISTS (SELECT 1 FROM deliveries l WHERE l.user_id = ?4 AND l.marker = d.marker
             AND l.status = 'claimed' AND l.claimed_until > ?3)
       ) WHERE n = 1 ORDER BY created_at, rank, id LIMIT ?5
     )
     RETURNING id, recommendation_id, created_at`,
  )
    .bind(body.installationId, addSeconds(now, LEASE_SECONDS), now, user.id, body.limit)
    .all<{ id: string; recommendation_id: string; created_at: string }>();

  const { results: recs } = await c.env.DB.prepare(
    `SELECT ${RECOMMENDATION_COLUMNS} FROM recommendations r
     WHERE r.id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(claimed.map((d) => d.recommendation_id)))
    .all<RecommendationRow>();
  const byRow = new Map(recs.map((row) => [row.id, row]));
  // RETURNING keeps no order: sort again as the statement chose.
  const deliveries = claimed
    .map((d) => {
      const row = byRow.get(d.recommendation_id);
      if (row === undefined) throw new Error(`claim: delivery ${d.id} has no recommendation`);
      return { d, row };
    })
    .sort(
      (x, y) =>
        x.d.created_at.localeCompare(y.d.created_at) ||
        x.row.rank - y.row.rank ||
        x.d.id.localeCompare(y.d.id),
    )
    .map(({ d, row }) => deliveryItem(d.id, recommendationFromRow(row, c.env.APP_ORIGIN)));
  log(c.get("rid"), "deliveries_claimed", { device: device.id, count: deliveries.length });
  return c.json(
    ClaimResponse.parse({
      deliveries,
      leaseSeconds: LEASE_SECONDS,
      embedInMyReminders: user.reminderSettings.embedInMyReminders,
    }),
  );
});

// A result counts only from the installation of the last claim while the delivery is claimed, also after its
// lease ended. failed returns it to pending below MAX_FAILURES failures.
deliveryRoutes.post("/results", requireUser, async (c) => {
  const body = await readJson(c, ResultsBody);
  const db = c.env.DB;
  const userId = c.var.user.id;
  const now = nowIso();
  const owned = "WHERE id = ? AND user_id = ? AND status = 'claimed' AND claimed_by = ?";
  const statements = body.results.map((r) =>
    r.outcome === "failed"
      ? db
          .prepare(
            `UPDATE deliveries SET failures = failures + 1,
               status = CASE WHEN failures + 1 >= ${MAX_FAILURES} THEN 'failed' ELSE 'pending' END,
               error_code = ?, updated_at = ?
             ${owned}`,
          )
          .bind(r.errorCode ?? null, now, r.deliveryId, userId, body.installationId)
      : db
          .prepare(
            `UPDATE deliveries SET status = 'applied', outcome = ?, error_code = NULL, updated_at = ? ${owned}`,
          )
          .bind(r.outcome, now, r.deliveryId, userId, body.installationId),
  );
  const done = await db.batch(statements);
  const counted = body.results.map((r, i) => ({
    outcome: r.outcome,
    changed: (done[i]?.meta.changes ?? 0) > 0,
  }));
  const accepted = counted.filter((r) => r.changed).length;
  const outcomes: Record<string, number> = {};
  for (const r of counted) if (r.changed) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const codes = body.results.filter((r) => r.outcome === "failed").map((r) => r.errorCode ?? "none");
  log(c.get("rid"), "delivery_results", {
    received: body.results.length,
    accepted,
    ...outcomes,
    errorCodes: codes.join(","),
  });
  return c.json(ResultsResponse.parse({ accepted }));
});

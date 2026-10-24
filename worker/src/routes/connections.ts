// /api/sources and /api/connections: the sources MOZOL accepts and the user's webhook connections
// (shared/CONTRACT.md, "Endpoints: sources and connections").
import { Hono } from "hono";
import {
  ConnectionResponse,
  ConnectionsResponse,
  CreateConnectionBody,
  HookEventsResponse,
  PatchConnectionBody,
  SourcesResponse,
} from "shared";
import { requireUser } from "../auth/session";
import { newToken } from "../auth/tokens";
import {
  type ConnectionRow,
  connectionFromRow,
  findConnection,
  type HookEventRow,
  hookEventFromRow,
} from "../db/connections";
import type { AppEnv } from "../env";
import { ApiError, readJson } from "../errors";
import { newId } from "../ids";
import { log } from "../log";
import { sourceById, sources } from "../sources/registry";
import { nowIso } from "../time";

const EVENTS_SHOWN = 20;

export const sourceRoutes = new Hono<AppEnv>();

sourceRoutes.get("/", requireUser, (c) => {
  const list = Object.values(sources).map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    webhook: s.webhook,
    setupSteps: [...s.setupSteps],
  }));
  return c.json(SourcesResponse.parse({ sources: list }));
});

export const connectionRoutes = new Hono<AppEnv>();

connectionRoutes.get("/", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM connections WHERE user_id = ? ORDER BY created_at, id",
  )
    .bind(c.var.user.id)
    .all<ConnectionRow>();
  const connections = results.map((row) => connectionFromRow(row, c.env.APP_ORIGIN));
  return c.json(ConnectionsResponse.parse({ connections }));
});

// The hook token is 32 random bytes in base64url. It is kept as it is: the owner can copy the URL at any time.
connectionRoutes.post("/", requireUser, async (c) => {
  const body = await readJson(c, CreateConnectionBody);
  const now = nowIso();
  const row = await c.env.DB.prepare(
    `INSERT INTO connections (id, user_id, source, label, hook_token, status, settings, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', '{}', ?, ?)
     RETURNING *`,
  )
    .bind(
      newId("con"),
      c.var.user.id,
      body.source,
      body.label ?? sources[body.source].name,
      newToken(),
      now,
      now,
    )
    .first<ConnectionRow>();
  if (row === null) throw new Error("POST /api/connections: the insert returned no row");
  log(c.get("rid"), "connection_created", { connection: row.id, source: row.source });
  return c.json(ConnectionResponse.parse({ connection: connectionFromRow(row, c.env.APP_ORIGIN) }), 201);
});

connectionRoutes.patch("/:id", requireUser, async (c) => {
  const body = await readJson(c, PatchConnectionBody);
  const current = await findConnection(c.env.DB, c.var.user.id, c.req.param("id"));
  if (current === null) throw new ApiError(404, "not_found");
  // A secret on a source without a signature check would never be checked.
  if (typeof body.signingSecret === "string" && sourceById(current.source)?.verify === undefined) {
    throw new ApiError(400, "validation_failed", [{ path: "signingSecret", code: "custom" }]);
  }

  const changes: [column: string, value: string | null][] = [];
  if (body.label !== undefined) changes.push(["label", body.label]);
  if (body.status !== undefined) changes.push(["status", body.status]);
  if (body.signingSecret !== undefined) changes.push(["signing_secret", body.signingSecret]);
  if (changes.length === 0) {
    return c.json(ConnectionResponse.parse({ connection: connectionFromRow(current, c.env.APP_ORIGIN) }));
  }

  const sets = changes.map(([column]) => `${column} = ?`).join(", ");
  const row = await c.env.DB.prepare(
    `UPDATE connections SET ${sets}, updated_at = ? WHERE id = ? AND user_id = ? RETURNING *`,
  )
    .bind(...changes.map(([, value]) => value), nowIso(), current.id, c.var.user.id)
    .first<ConnectionRow>();
  if (row === null) throw new ApiError(404, "not_found");
  return c.json(ConnectionResponse.parse({ connection: connectionFromRow(row, c.env.APP_ORIGIN) }));
});

// A new token: the old webhook URL answers 404 hook_not_found from now on.
connectionRoutes.post("/:id/rotate", requireUser, async (c) => {
  const row = await c.env.DB.prepare(
    "UPDATE connections SET hook_token = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING *",
  )
    .bind(newToken(), nowIso(), c.req.param("id"), c.var.user.id)
    .first<ConnectionRow>();
  if (row === null) throw new ApiError(404, "not_found");
  log(c.get("rid"), "connection_rotated", { connection: row.id });
  return c.json(ConnectionResponse.parse({ connection: connectionFromRow(row, c.env.APP_ORIGIN) }));
});

// The foreign keys delete the connection's hook events and keep its transcripts with connection_id null.
connectionRoutes.delete("/:id", requireUser, async (c) => {
  const result = await c.env.DB.prepare("DELETE FROM connections WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.var.user.id)
    .run();
  if (result.meta.changes === 0) throw new ApiError(404, "not_found");
  log(c.get("rid"), "connection_deleted", { connection: c.req.param("id") });
  return c.body(null, 204);
});

connectionRoutes.get("/:id/events", requireUser, async (c) => {
  const connection = await findConnection(c.env.DB, c.var.user.id, c.req.param("id"));
  if (connection === null) throw new ApiError(404, "not_found");
  const { results } = await c.env.DB.prepare(
    `SELECT id, received_at, outcome, error_code, size_bytes, transcript_id FROM hook_events
     WHERE connection_id = ? ORDER BY received_at DESC, id DESC LIMIT ?`,
  )
    .bind(connection.id, EVENTS_SHOWN)
    .all<HookEventRow>();
  return c.json(HookEventsResponse.parse({ events: results.map(hookEventFromRow) }));
});

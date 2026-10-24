// /api/transcripts: paste, list and read transcripts (shared/CONTRACT.md, "Endpoints: transcripts").
import { Hono } from "hono";
import {
  PageQuery,
  PasteTranscriptBody,
  Time,
  TranscriptDetailResponse,
  TranscriptResponse,
  TranscriptsPage,
} from "shared";
import { requireUser } from "../auth/session";
import {
  findTranscript,
  readSegments,
  TRANSCRIPT_COLUMNS,
  type TranscriptRow,
  transcriptFromRow,
} from "../db/transcripts";
import type { AppEnv } from "../env";
import { ApiError, parseInput, readJson } from "../errors";
import { storeTranscript } from "../pipeline/intake";
import { pasteAdapter, pasteTranscript } from "../sources/paste";
import { nowIso } from "../time";

const TRANSCRIPT_ID = /^trn_[0-9A-HJKMNP-TV-Z]{26}$/;

export const transcriptRoutes = new Hono<AppEnv>();

// The paste source: no hook event, the intake starts at the adapter (docs/backend/pipeline.md).
transcriptRoutes.post("/", requireUser, async (c) => {
  const body = await readJson(c, PasteTranscriptBody);
  const user = c.var.user;
  const transcript = pasteTranscript(body, { receivedAt: nowIso(), userName: user.displayName });
  if (transcript === null) throw new ApiError(422, "payload_invalid");
  const stored = await storeTranscript(c.env, c.get("rid"), {
    user,
    connectionId: null,
    adapter: pasteAdapter,
    transcript,
  });
  if (stored.outcome === "too_large") throw new ApiError(422, "payload_invalid");
  const row = await findTranscript(c.env.DB, user.id, stored.transcriptId);
  if (row === null) throw new Error("POST /api/transcripts: the stored transcript does not exist");
  return c.json(TranscriptResponse.parse({ transcript: transcriptFromRow(row) }), 201);
});

// Newest occurredAt first. The cursor is "<occurredAt>_<id>" of the last transcript of the page before.
transcriptRoutes.get("/", requireUser, async (c) => {
  const query = parseInput(PageQuery, c.req.query());
  const after = query.cursor === undefined ? null : parseCursor(query.cursor);
  const statement =
    after === null
      ? c.env.DB.prepare(
          `SELECT ${TRANSCRIPT_COLUMNS} FROM transcripts t WHERE t.user_id = ?1
           ORDER BY t.occurred_at DESC, t.id DESC LIMIT ?2`,
        ).bind(c.var.user.id, query.limit + 1)
      : c.env.DB.prepare(
          `SELECT ${TRANSCRIPT_COLUMNS} FROM transcripts t
           WHERE t.user_id = ?1 AND (t.occurred_at < ?2 OR (t.occurred_at = ?2 AND t.id < ?3))
           ORDER BY t.occurred_at DESC, t.id DESC LIMIT ?4`,
        ).bind(c.var.user.id, after.occurredAt, after.id, query.limit + 1);
  const { results } = await statement.all<TranscriptRow>();
  const page = results.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor = results.length > query.limit && last ? `${last.occurred_at}_${last.id}` : null;
  return c.json(TranscriptsPage.parse({ items: page.map(transcriptFromRow), nextCursor }));
});

// analysis and recommendations come with steps B08 and B09.
transcriptRoutes.get("/:id", requireUser, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT ${TRANSCRIPT_COLUMNS}, t.segments FROM transcripts t WHERE t.id = ? AND t.user_id = ?`,
  )
    .bind(c.req.param("id"), c.var.user.id)
    .first<TranscriptRow & { segments: string }>();
  if (row === null) throw new ApiError(404, "not_found");
  const segments = readSegments(row.segments);
  const transcript = {
    ...transcriptFromRow(row),
    segments,
    analysis: null,
    recommendations: [],
  };
  return c.json(TranscriptDetailResponse.parse({ transcript }));
});

function parseCursor(cursor: string): { occurredAt: string; id: string } {
  const split = cursor.indexOf("_");
  const occurredAt = cursor.slice(0, split);
  const id = cursor.slice(split + 1);
  if (split < 0 || !Time.safeParse(occurredAt).success || !TRANSCRIPT_ID.test(id)) {
    throw new ApiError(400, "validation_failed", [{ path: "cursor", code: "invalid_format" }]);
  }
  return { occurredAt, id };
}

// /api/transcripts: paste, list and read transcripts (shared/CONTRACT.md, "Endpoints: transcripts").
import { Hono } from "hono";
import {
  type Analysis,
  AnalysisResult,
  PageQuery,
  PasteTranscriptBody,
  Time,
  TranscriptDetailResponse,
  TranscriptResponse,
  TranscriptsPage,
} from "shared";
import { requireUser } from "../auth/session";
import { readJson as readJsonColumn } from "../db/json";
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
import { startAnalysis } from "../pipeline/start";
import { clearResults } from "../pipeline/store";
import { pasteAdapter, pasteTranscript } from "../sources/paste";
import { nowIso } from "../time";

const TRANSCRIPT_ID = /^trn_[0-9A-HJKMNP-TV-Z]{26}$/;

// A queued or analyzing transcript that changed less than this long ago is busy (transcript_busy).
const BUSY_MS = 30 * 60 * 1000;

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

type AnalysisColumns = {
  analysis_id: string | null;
  analysis_model: string | null;
  analysis_prompt_version: string | null;
  analysis_created_at: string | null;
  analysis_result: string | null;
};

// The analysis is the one of the current run: a run in progress, or one that ended skipped by too_short, shows
// none. Recommendations come with step B09.
transcriptRoutes.get("/:id", requireUser, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT ${TRANSCRIPT_COLUMNS}, t.segments, a.id AS analysis_id, a.model AS analysis_model,
       a.prompt_version AS analysis_prompt_version, a.created_at AS analysis_created_at, a.result AS analysis_result
     FROM transcripts t LEFT JOIN analyses a ON a.transcript_id = t.id AND a.run = t.run
     WHERE t.id = ? AND t.user_id = ?`,
  )
    .bind(c.req.param("id"), c.var.user.id)
    .first<TranscriptRow & AnalysisColumns & { segments: string }>();
  if (row === null) throw new ApiError(404, "not_found");
  const transcript = {
    ...transcriptFromRow(row),
    segments: readSegments(row.segments),
    analysis: analysisFromRow(row),
    recommendations: [],
  };
  return c.json(TranscriptDetailResponse.parse({ transcript }));
});

// Analyze again (docs/backend/pipeline.md, "Statuses").
transcriptRoutes.post("/:id/analyze", requireUser, async (c) => {
  const userId = c.var.user.id;
  const id = c.req.param("id");
  const row = await findTranscript(c.env.DB, userId, id);
  if (row === null) throw new ApiError(404, "not_found");
  const busy = row.status === "queued" || row.status === "analyzing";
  if (busy && Date.now() - Date.parse(row.updated_at) < BUSY_MS) throw new ApiError(409, "transcript_busy");
  await startAnalysis(c.env, id, c.get("rid"));
  const started = await findTranscript(c.env.DB, userId, id);
  if (started === null) throw new Error("POST /api/transcripts/:id/analyze: the transcript is gone");
  return c.json(TranscriptResponse.parse({ transcript: transcriptFromRow(started) }), 202);
});

// Deletes the transcript and its analysis; pattern and word counts are recomputed first. Recommendations stay.
transcriptRoutes.delete("/:id", requireUser, async (c) => {
  const id = c.req.param("id");
  const row = await findTranscript(c.env.DB, c.var.user.id, id);
  if (row === null) throw new ApiError(404, "not_found");
  await clearResults(c.env, id);
  await c.env.DB.prepare("DELETE FROM transcripts WHERE id = ? AND user_id = ?")
    .bind(id, c.var.user.id)
    .run();
  return c.body(null, 204);
});

function analysisFromRow(row: AnalysisColumns): Analysis | null {
  const { analysis_id: id, analysis_model: model, analysis_prompt_version: promptVersion } = row;
  const { analysis_created_at: createdAt, analysis_result: result } = row;
  if (id === null) return null;
  if (model === null || promptVersion === null || createdAt === null || result === null) {
    throw new Error(`analysisFromRow: analysis ${id} has empty columns`);
  }
  return {
    id,
    model,
    promptVersion,
    createdAt,
    result: readJsonColumn(result, AnalysisResult, "analyses.result"),
  };
}

function parseCursor(cursor: string): { occurredAt: string; id: string } {
  const split = cursor.indexOf("_");
  const occurredAt = cursor.slice(0, split);
  const id = cursor.slice(split + 1);
  if (split < 0 || !Time.safeParse(occurredAt).success || !TRANSCRIPT_ID.test(id)) {
    throw new ApiError(400, "validation_failed", [{ path: "cursor", code: "invalid_format" }]);
  }
  return { occurredAt, id };
}

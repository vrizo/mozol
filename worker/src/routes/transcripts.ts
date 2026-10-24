// /api/transcripts: paste, list, read and choose the user's speaker (shared/CONTRACT.md, "Endpoints: transcripts").
import { Hono } from "hono";
import {
  PageQuery,
  PasteTranscriptBody,
  SpeakerBody,
  Time,
  TranscriptDetailResponse,
  TranscriptResponse,
  TranscriptsPage,
  type User,
} from "shared";
import { requireUser } from "../auth/session";
import {
  findTranscript,
  readSegments,
  TRANSCRIPT_COLUMNS,
  type TranscriptRow,
  transcriptFromRow,
} from "../db/transcripts";
import type { AppEnv, Env } from "../env";
import { ApiError, parseInput, readJson } from "../errors";
import { log } from "../log";
import { storeTranscript } from "../pipeline/intake";
import { startAnalysis } from "../pipeline/start";
import { nameKey, speakersOf } from "../sources/learner";
import { pasteAdapter, pasteTranscript } from "../sources/paste";
import { sourceById } from "../sources/registry";
import type { SourceAdapter } from "../sources/types";
import { addSeconds, nowIso } from "../time";

// Choosing a speaker waits while a run is queued or analyzing and changed less than 30 minutes ago.
const BUSY_SECONDS = 30 * 60;
const MAX_SPEAKER_NAMES = 10;
const MAX_SPEAKER_NAME_LENGTH = 80;
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
    speakers: speakersOf(segments),
    segments,
    analysis: null,
    recommendations: [],
  };
  return c.json(TranscriptDetailResponse.parse({ transcript }));
});

// Makes the speaker the learner, saves its name as a speaker name of the user and starts the analysis.
transcriptRoutes.post("/:id/speaker", requireUser, async (c) => {
  const body = await readJson(c, SpeakerBody);
  const row = await c.env.DB.prepare(
    "SELECT id, source, segments FROM transcripts WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), c.var.user.id)
    .first<{ id: string; source: string; segments: string }>();
  if (row === null) throw new ApiError(404, "not_found");
  const speaker = speakersOf(readSegments(row.segments)).find((s) => s.id === body.speakerId);
  if (speaker === undefined) {
    throw new ApiError(400, "validation_failed", [{ path: "speakerId", code: "invalid_value" }]);
  }
  const adapter = sourceById(row.source);
  if (adapter === null) throw new Error(`speaker: no adapter for source ${row.source}`);

  const now = nowIso();
  const updated = await c.env.DB.prepare(
    `UPDATE transcripts SET learner_speaker_id = ?, learner_word_count = ?, updated_at = ?
     WHERE id = ? AND NOT (status IN ('queued', 'analyzing') AND updated_at > ?)
     RETURNING id`,
  )
    .bind(speaker.id, speaker.wordCount, now, row.id, addSeconds(now, -BUSY_SECONDS))
    .first<{ id: string }>();
  if (updated === null) throw new ApiError(409, "transcript_busy");

  await saveSpeakerName(c.env, c.get("rid"), c.var.user, adapter, speaker.name);
  await startAnalysis(c.env, row.id, c.get("rid"));
  const transcript = await findTranscript(c.env.DB, c.var.user.id, row.id);
  if (transcript === null) throw new Error("speaker: the transcript does not exist after the update");
  return c.json(TranscriptResponse.parse({ transcript: transcriptFromRow(transcript) }));
});

// Adds the name unless it is a placeholder or already saved. A name that does not fit the profile limits
// (10 names of 1..80 characters) is not saved, and the log says why.
async function saveSpeakerName(
  env: Env,
  rid: string,
  user: User,
  adapter: SourceAdapter,
  name: string,
): Promise<void> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean === "" || adapter.isPlaceholderName(clean)) return;
  if (user.speakerNames.some((saved) => nameKey(saved) === nameKey(clean))) return;
  if (clean.length > MAX_SPEAKER_NAME_LENGTH || user.speakerNames.length >= MAX_SPEAKER_NAMES) {
    const reason = clean.length > MAX_SPEAKER_NAME_LENGTH ? "too_long" : "list_full";
    log(rid, "speaker_name_not_saved", { user: user.id, reason });
    return;
  }
  await env.DB.prepare(
    `UPDATE users SET speaker_names = json_insert(speaker_names, '$[#]', ?), updated_at = ?
     WHERE id = ? AND json_array_length(speaker_names) < ?`,
  )
    .bind(clean, nowIso(), user.id, MAX_SPEAKER_NAMES)
    .run();
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

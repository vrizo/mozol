// POST /api/hooks/:source/:token: webhook intake (docs/backend/pipeline.md, "Intake"; shared/CONTRACT.md,
// "Endpoints: webhooks"). No session: the token in the URL is the key. Every request with a known token gets a
// hook_events row, also a refused one.
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type HookOutcome, HookResponse } from "shared";
import { sha256Hex } from "../auth/tokens";
import type { ConnectionRow } from "../db/connections";
import { findUserById, userFromRow } from "../db/users";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { newId } from "../ids";
import { log } from "../log";
import { storeTranscript } from "../pipeline/intake";
import { sourceById } from "../sources/registry";
import { nowIso } from "../time";

const MAX_BODY_BYTES = 1_000_000;

// text is null when the body is larger than MAX_BODY_BYTES; size is what arrived, or what Content-Length announced.
type Body = { text: string | null; size: number };

type Answer = {
  status: ContentfulStatusCode;
  outcome: HookOutcome;
  errorCode: string | null;
  transcriptId: string | null;
};

export const hookRoutes = new Hono<AppEnv>();

hookRoutes.post("/:source/:token", async (c) => {
  const receivedAt = nowIso();
  const connection = await c.env.DB.prepare("SELECT * FROM connections WHERE hook_token = ?")
    .bind(c.req.param("token"))
    .first<ConnectionRow>();
  if (connection === null || connection.source !== c.req.param("source")) {
    throw new ApiError(404, "hook_not_found");
  }

  const body = await readBody(c.req.raw);
  let answer: Answer;
  try {
    answer = await intake(c, connection, body, receivedAt);
  } catch (err) {
    await recordEvent(c, connection, body, receivedAt, refused(500, "internal"));
    throw err;
  }
  await recordEvent(c, connection, body, receivedAt, answer);

  if (answer.outcome === "refused") {
    const headers = answer.errorCode === "rate_limited" ? { "Retry-After": "60" } : undefined;
    return c.json({ error: answer.errorCode }, answer.status, headers);
  }
  const response =
    answer.outcome === "ignored"
      ? { ok: true, outcome: answer.outcome }
      : { ok: true, outcome: answer.outcome, transcriptId: answer.transcriptId };
  return c.json(HookResponse.parse(response), answer.status);
});

// Steps 3 to 8 of the intake; the rate limit of 60 requests per minute and token comes first.
async function intake(
  c: Context<AppEnv>,
  connection: ConnectionRow,
  body: Body,
  receivedAt: string,
): Promise<Answer> {
  const { success } = await c.env.HOOK_LIMITER.limit({ key: connection.hook_token });
  if (!success) return refused(429, "rate_limited");
  if (connection.status === "paused") return refused(403, "hook_paused");
  if (mediaType(c.req.header("Content-Type")) !== "application/json") {
    return refused(415, "unsupported_media_type");
  }
  if (body.text === null) return refused(413, "payload_too_large");

  const adapter = sourceById(connection.source);
  if (adapter === null) throw new Error(`hooks: no adapter for source ${connection.source}`);
  const headers = c.req.raw.headers;
  if (connection.signing_secret !== null) {
    if (adapter.verify === undefined) throw new Error(`hooks: source ${adapter.id} has no signature check`);
    const valid = await adapter.verify(body.text, headers, { signingSecret: connection.signing_secret });
    if (!valid) return refused(401, "signature_invalid");
  }

  const userRow = await findUserById(c.env.DB, connection.user_id);
  if (userRow === null) throw new Error("hooks: the connection's user does not exist");
  const user = userFromRow(userRow);
  const parsed = adapter.parse(body.text, headers, { receivedAt, userName: user.displayName });
  if (parsed.outcome === "ignored") return answer(200, "ignored", null);
  if (parsed.outcome === "refused") return refused(parsed.error === "bad_json" ? 400 : 422, parsed.error);

  const stored = await storeTranscript(c.env, c.get("rid"), {
    user,
    connectionId: connection.id,
    adapter,
    transcript: parsed.transcript,
  });
  if (stored.outcome === "too_large") return refused(422, "payload_invalid");
  return answer(stored.outcome === "accepted" ? 202 : 200, stored.outcome, stored.transcriptId);
}

// The hook_events row, the connection's last event, and one log line: ids, outcome, code and size, never the body.
async function recordEvent(
  c: Context<AppEnv>,
  connection: ConnectionRow,
  body: Body,
  receivedAt: string,
  answer: Answer,
): Promise<void> {
  const stored = body.text ?? "";
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO hook_events
         (id, connection_id, user_id, received_at, request_id, content_type, size_bytes, body, body_sha256,
          outcome, error_code, transcript_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newId("evt"),
      connection.id,
      connection.user_id,
      receivedAt,
      c.get("rid"),
      c.req.header("Content-Type")?.slice(0, 200) ?? null,
      body.size,
      stored,
      await sha256Hex(stored),
      answer.outcome,
      answer.errorCode,
      answer.transcriptId,
    ),
    c.env.DB.prepare(
      "UPDATE connections SET last_event_at = ?, last_event_outcome = ?, last_event_error = ? WHERE id = ?",
    ).bind(receivedAt, answer.outcome, answer.errorCode, connection.id),
  ]);
  log(c.get("rid"), "hook_event", {
    connection: connection.id,
    outcome: answer.outcome,
    code: answer.errorCode,
    bytes: body.size,
    transcript: answer.transcriptId,
  });
}

async function readBody(request: Request): Promise<Body> {
  const announced = Number(request.headers.get("Content-Length") ?? 0);
  if (announced > MAX_BODY_BYTES) return { text: null, size: announced };
  if (request.body === null) return { text: "", size: 0 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { text: null, size };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), size };
}

function mediaType(header: string | undefined): string | undefined {
  return header?.split(";")[0]?.trim().toLowerCase();
}

function answer(status: ContentfulStatusCode, outcome: HookOutcome, transcriptId: string | null): Answer {
  return { status, outcome, errorCode: null, transcriptId };
}

function refused(status: ContentfulStatusCode, errorCode: string): Answer {
  return { status, outcome: "refused", errorCode, transcriptId: null };
}

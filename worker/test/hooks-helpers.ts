// Connections, webhook requests, Jamie signatures and the stored rows, for the source and transcript tests.
import { env } from "cloudflare:workers";
import { type Connection, ConnectionResponse } from "shared";
import meeting from "shared/fixtures/jamie/meeting-completed.json";
import { expect } from "vitest";
import { toHex } from "../src/auth/bytes";
import { call } from "./helpers";

export async function connect(cookie: string, source: "jamie" | "json", label?: string): Promise<Connection> {
  const res = await call("/api/connections", {
    cookie,
    body: label === undefined ? { source } : { source, label },
  });
  expect(res.status).toBe(201);
  return ConnectionResponse.parse(await res.json()).connection;
}

export function hookPath(connection: Connection): string {
  return new URL(connection.webhookUrl).pathname;
}

// A webhook request: no session and no Origin, Content-Type application/json unless headers say otherwise.
export function postHook(
  path: string,
  rawBody: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return call(path, {
    method: "POST",
    rawBody,
    origin: null,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// The Jamie fixture as a raw body, with changes to its delivery id or recorder email.
export function jamieBody(changes: { deliveryId?: string; recorderEmail?: string } = {}): string {
  const body = structuredClone(meeting);
  if (changes.deliveryId !== undefined) body.metadata.id = changes.deliveryId;
  if (changes.recorderEmail !== undefined) body.data.user.email = changes.recorderEmail;
  return JSON.stringify(body);
}

// x-jamie-signature for the raw body: "t=<seconds>,v0=<HMAC-SHA256 hex of "<t>.<body>">".
export async function jamieSignature(rawBody: string, secret: string, t: number): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${rawBody}`));
  return `t=${t},v0=${toHex(new Uint8Array(mac))}`;
}

export type HookEventRow = {
  outcome: string;
  error_code: string | null;
  size_bytes: number;
  body: string;
  body_sha256: string;
  content_type: string | null;
  request_id: string;
  transcript_id: string | null;
};

// The connection's hook events, oldest first.
export async function hookEvents(connectionId: string): Promise<HookEventRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM hook_events WHERE connection_id = ? ORDER BY received_at, rowid",
  )
    .bind(connectionId)
    .all<HookEventRow>();
  return results;
}

export async function lastHookEvent(connectionId: string): Promise<HookEventRow> {
  const event = (await hookEvents(connectionId)).at(-1);
  if (event === undefined) throw new Error("lastHookEvent: the connection has no hook events");
  return event;
}

export type StoredTranscript = {
  id: string;
  user_id: string;
  connection_id: string | null;
  source: string;
  external_id: string | null;
  kind: string;
  title: string | null;
  occurred_at: string;
  duration_sec: number | null;
  participants: string;
  segments: string;
  learner_speaker_id: string | null;
  learner_word_count: number | null;
  status: string;
  error_code: string | null;
  run: number;
  updated_at: string;
};

export async function storedTranscript(id: string): Promise<StoredTranscript> {
  const row = await env.DB.prepare("SELECT * FROM transcripts WHERE id = ?")
    .bind(id)
    .first<StoredTranscript>();
  if (row === null) throw new Error(`storedTranscript: no transcript ${id}`);
  return row;
}

// The connections and hook_events tables and their mapping to the API Connection and HookEvent (shared/CONTRACT.md).
import { Connection, HookEvent } from "shared";

export type ConnectionRow = {
  id: string;
  user_id: string;
  source: string;
  label: string;
  hook_token: string;
  signing_secret: string | null;
  status: string;
  settings: string;
  last_event_at: string | null;
  last_event_outcome: string | null;
  last_event_error: string | null;
  created_at: string;
  updated_at: string;
};

export type HookEventRow = {
  id: string;
  received_at: string;
  outcome: string;
  error_code: string | null;
  size_bytes: number;
  transcript_id: string | null;
};

export function connectionFromRow(row: ConnectionRow, appOrigin: string): Connection {
  return Connection.parse({
    id: row.id,
    source: row.source,
    label: row.label,
    status: row.status,
    webhookUrl: `${appOrigin}/api/hooks/${row.source}/${row.hook_token}`,
    hasSigningSecret: row.signing_secret !== null,
    lastEventAt: row.last_event_at,
    lastEventOutcome: row.last_event_outcome,
    lastEventError: row.last_event_error,
    createdAt: row.created_at,
  });
}

export function hookEventFromRow(row: HookEventRow): HookEvent {
  return HookEvent.parse({
    id: row.id,
    receivedAt: row.received_at,
    outcome: row.outcome,
    errorCode: row.error_code,
    sizeBytes: row.size_bytes,
    transcriptId: row.transcript_id,
  });
}

export async function findConnection(
  db: D1Database,
  userId: string,
  id: string,
): Promise<ConnectionRow | null> {
  return db
    .prepare("SELECT * FROM connections WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<ConnectionRow>();
}

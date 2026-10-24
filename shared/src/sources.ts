// Sources, connections, webhook events and responses, and the body of the json source.
import { z } from "zod";
import { Id, SourceId, SourceKind, Time } from "./common";

export const Source = z.strictObject({
  id: SourceId,
  name: z.string().min(1),
  kind: SourceKind,
  webhook: z.boolean(),
  setupSteps: z.array(z.string().min(1)),
});
export type Source = z.infer<typeof Source>;

export const SourcesResponse = z.strictObject({ sources: z.array(Source) });
export type SourcesResponse = z.infer<typeof SourcesResponse>;

export const HookOutcome = z.enum(["accepted", "duplicate", "ignored", "refused"]);
export type HookOutcome = z.infer<typeof HookOutcome>;

export const ConnectionSource = z.enum(["jamie", "json"]);
export type ConnectionSource = z.infer<typeof ConnectionSource>;

const ConnectionLabel = z.string().min(1).max(80);
const ConnectionStatus = z.enum(["active", "paused"]);

export const Connection = z.strictObject({
  id: Id,
  source: ConnectionSource,
  label: ConnectionLabel,
  status: ConnectionStatus,
  webhookUrl: z.url(),
  hasSigningSecret: z.boolean(),
  lastEventAt: Time.nullable(),
  lastEventOutcome: HookOutcome.nullable(),
  lastEventError: z.string().nullable(),
  createdAt: Time,
});
export type Connection = z.infer<typeof Connection>;

export const ConnectionResponse = z.strictObject({ connection: Connection });
export type ConnectionResponse = z.infer<typeof ConnectionResponse>;

export const ConnectionsResponse = z.strictObject({ connections: z.array(Connection) });
export type ConnectionsResponse = z.infer<typeof ConnectionsResponse>;

export const CreateConnectionBody = z.strictObject({
  source: ConnectionSource,
  label: ConnectionLabel.optional(),
});
export type CreateConnectionBody = z.infer<typeof CreateConnectionBody>;

// signingSecret: a string sets it, null removes it.
export const PatchConnectionBody = z.strictObject({
  label: ConnectionLabel.optional(),
  status: ConnectionStatus.optional(),
  signingSecret: z.string().min(1).max(200).nullable().optional(),
});
export type PatchConnectionBody = z.infer<typeof PatchConnectionBody>;

export const HookEvent = z.strictObject({
  id: Id,
  receivedAt: Time,
  outcome: HookOutcome,
  errorCode: z.string().nullable(),
  sizeBytes: z.number().int().min(0),
  transcriptId: Id.nullable(),
});
export type HookEvent = z.infer<typeof HookEvent>;

// The newest 20.
export const HookEventsResponse = z.strictObject({ events: z.array(HookEvent).max(20) });
export type HookEventsResponse = z.infer<typeof HookEventsResponse>;

export const HookAcceptedResponse = z.strictObject({
  ok: z.literal(true),
  outcome: z.literal("accepted"),
  transcriptId: Id,
});
export const HookDuplicateResponse = z.strictObject({
  ok: z.literal(true),
  outcome: z.literal("duplicate"),
  transcriptId: Id,
});
export const HookIgnoredResponse = z.strictObject({ ok: z.literal(true), outcome: z.literal("ignored") });

export const HookResponse = z.discriminatedUnion("outcome", [
  HookAcceptedResponse,
  HookDuplicateResponse,
  HookIgnoredResponse,
]);
export type HookResponse = z.infer<typeof HookResponse>;

export const JsonSourceBody = z.strictObject({
  id: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(300).optional(),
  occurredAt: Time.optional(),
  kind: SourceKind.default("call"),
  learnerSpeaker: z.string().min(1).optional(),
  segments: z
    .array(z.strictObject({ speaker: z.string().min(1), text: z.string() }))
    .min(1)
    .max(20000),
});
export type JsonSourceBody = z.infer<typeof JsonSourceBody>;

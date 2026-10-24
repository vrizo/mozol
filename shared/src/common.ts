// Types used by every area of the contract: ids, times, languages, errors, paged lists.
import { z } from "zod";

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

// ISO 8601 UTC with milliseconds: "2026-10-24T12:00:00.000Z".
export const Time = z.iso.datetime({ precision: 3 });
export type Time = z.infer<typeof Time>;

// BCP 47 primary tag.
export const LanguageCode = z.string().regex(/^[a-z]{2,3}$/);
export type LanguageCode = z.infer<typeof LanguageCode>;

export const SourceId = z.enum(["jamie", "paste", "json"]);
export type SourceId = z.infer<typeof SourceId>;

export const SourceKind = z.enum(["call", "chat", "text"]);
export type SourceKind = z.infer<typeof SourceKind>;

// Made by the app once per install and kept in the Keychain.
export const InstallationId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const ErrorCode = z.enum([
  "bad_json",
  "validation_failed",
  "code_invalid",
  "unauthorized",
  "invalid_credentials",
  "signature_invalid",
  "forbidden",
  "hook_paused",
  "not_found",
  "hook_not_found",
  "email_taken",
  "transcript_busy",
  "payload_too_large",
  "unsupported_media_type",
  "payload_invalid",
  "rate_limited",
  "internal",
  "push_not_configured",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorIssue = z.strictObject({ path: z.string(), code: z.string() });

export const ErrorBody = z.strictObject({
  error: ErrorCode,
  issues: z.array(ErrorIssue).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const PageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

export function paged<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
}
export type Paged<T> = { items: T[]; nextCursor: string | null };

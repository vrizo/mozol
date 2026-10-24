// The only module that calls fetch: JSON requests to /api, parsed with the shared schemas.
import {
  AppCodeResponse,
  ConnectionResponse,
  type ConnectionSource,
  ConnectionsResponse,
  type DeleteMeBody,
  DevicesResponse,
  ErrorBody,
  HookEventsResponse,
  type PasteTranscriptBody,
  type PatchConnectionBody,
  type PatchMeBody,
  PatternResponse,
  type PatternStatus,
  PatternsResponse,
  RecommendationResponse,
  RecommendationsPage,
  type SignInBody,
  type SignUpBody,
  SourcesResponse,
  TestPushResponse,
  TranscriptDetailResponse,
  TranscriptResponse,
  TranscriptsPage,
  UserResponse,
  WordResponse,
  type WordStatus,
  WordsResponse,
} from "shared";
import type { z } from "zod";

export type Issue = { path: string; code: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues: Issue[],
    readonly rid: string,
  ) {
    super(`${status} ${code} rid=${rid}`);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | undefined>;

export function requestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

// Steps: send with a fresh request id, log, turn a non-2xx answer into ApiError, parse the body with the schema.
export async function request<T extends z.ZodType>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Query; schema: T },
): Promise<z.infer<T>>;
export async function request(
  method: string,
  path: string,
  options?: { body?: unknown; query?: Query },
): Promise<void>;
export async function request(
  method: string,
  path: string,
  options: { body?: unknown; query?: Query; schema?: z.ZodType } = {},
): Promise<unknown> {
  const rid = requestId();
  const started = performance.now();
  console.info(`[api] → ${method} ${path} rid=${rid}`);
  const headers: Record<string, string> = { "X-Request-Id": rid, Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    credentials: "same-origin",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  console.info(`[api] ← ${response.status} rid=${rid} ${Math.round(performance.now() - started)}ms`);

  if (!response.ok) throw await errorFrom(response, rid);
  if (!options.schema) return undefined;
  const parsed = options.schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    console.error(`[api] bad_response rid=${rid}`, parsed.error.issues);
    throw new ApiError(response.status, "bad_response", [], rid);
  }
  return parsed.data;
}

async function errorFrom(response: Response, rid: string): Promise<ApiError> {
  const parsed = ErrorBody.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) return new ApiError(response.status, `http_${response.status}`, [], rid);
  return new ApiError(response.status, parsed.data.error, parsed.data.issues ?? [], rid);
}

// Accounts
export const getMe = () => request("GET", "/api/me", { schema: UserResponse }).then((r) => r.user);
export const signUp = (body: SignUpBody) =>
  request("POST", "/api/auth/sign-up", { body, schema: UserResponse }).then((r) => r.user);
export const signIn = (body: SignInBody) =>
  request("POST", "/api/auth/sign-in", { body, schema: UserResponse }).then((r) => r.user);
export const signOut = () => request("POST", "/api/auth/sign-out");
export const createAppCode = () => request("POST", "/api/auth/app-code", { schema: AppCodeResponse });
export const patchMe = (body: PatchMeBody) =>
  request("PATCH", "/api/me", { body, schema: UserResponse }).then((r) => r.user);
export const deleteMe = (body: DeleteMeBody) => request("DELETE", "/api/me", { body });

// Sources and connections
export const getSources = () =>
  request("GET", "/api/sources", { schema: SourcesResponse }).then((r) => r.sources);
export const getConnections = () =>
  request("GET", "/api/connections", { schema: ConnectionsResponse }).then((r) => r.connections);
export const createConnection = (source: ConnectionSource) =>
  request("POST", "/api/connections", { body: { source }, schema: ConnectionResponse }).then(
    (r) => r.connection,
  );
export const patchConnection = (id: string, body: PatchConnectionBody) =>
  request("PATCH", `/api/connections/${id}`, { body, schema: ConnectionResponse }).then((r) => r.connection);
export const rotateConnection = (id: string) =>
  request("POST", `/api/connections/${id}/rotate`, { schema: ConnectionResponse }).then((r) => r.connection);
export const deleteConnection = (id: string) => request("DELETE", `/api/connections/${id}`);
export const getConnectionEvents = (id: string) =>
  request("GET", `/api/connections/${id}/events`, { schema: HookEventsResponse }).then((r) => r.events);

// Transcripts
export const pasteTranscript = (body: PasteTranscriptBody) =>
  request("POST", "/api/transcripts", { body, schema: TranscriptResponse }).then((r) => r.transcript);
export const getTranscripts = (cursor?: string) =>
  request("GET", "/api/transcripts", { query: { cursor }, schema: TranscriptsPage });
export const getTranscript = (id: string) =>
  request("GET", `/api/transcripts/${id}`, { schema: TranscriptDetailResponse }).then((r) => r.transcript);
export const chooseSpeaker = (id: string, speakerId: string) =>
  request("POST", `/api/transcripts/${id}/speaker`, { body: { speakerId }, schema: TranscriptResponse }).then(
    (r) => r.transcript,
  );
export const analyzeAgain = (id: string) =>
  request("POST", `/api/transcripts/${id}/analyze`, { schema: TranscriptResponse }).then((r) => r.transcript);
export const deleteTranscript = (id: string) => request("DELETE", `/api/transcripts/${id}`);

// Patterns and words
export const getPatterns = (status: PatternStatus, language?: string) =>
  request("GET", "/api/patterns", { query: { status, language }, schema: PatternsResponse }).then(
    (r) => r.patterns,
  );
export const patchPattern = (id: string, status: PatternStatus) =>
  request("PATCH", `/api/patterns/${id}`, { body: { status }, schema: PatternResponse }).then(
    (r) => r.pattern,
  );
export const getWords = (status: WordStatus, language?: string) =>
  request("GET", "/api/words", { query: { status, language }, schema: WordsResponse }).then((r) => r.words);
export const patchWord = (id: string, status: WordStatus) =>
  request("PATCH", `/api/words/${id}`, { body: { status }, schema: WordResponse }).then((r) => r.word);

// Devices
export const getDevices = () =>
  request("GET", "/api/devices", { schema: DevicesResponse }).then((r) => r.devices);
export const testPush = (installationId: string) =>
  request("POST", `/api/devices/${encodeURIComponent(installationId)}/test-push`, {
    schema: TestPushResponse,
  });

// Recommendations
export const getRecommendations = (delivered: boolean, cursor?: string) =>
  request("GET", "/api/recommendations", { query: { delivered, cursor }, schema: RecommendationsPage });
export const getRecommendation = (id: string) =>
  request("GET", `/api/recommendations/${id}`, { schema: RecommendationResponse }).then(
    (r) => r.recommendation,
  );
export const deliverRecommendation = (id: string) =>
  request("POST", `/api/recommendations/${id}/deliver`, { schema: RecommendationResponse }).then(
    (r) => r.recommendation,
  );

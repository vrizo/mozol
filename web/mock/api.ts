// Dev mock of the MOZOL API (shared/CONTRACT.md): in memory, reset on restart. It lets the web app run in a browser
// before the worker has the endpoints. Every answer is checked against the shared schemas before it leaves.
import {
  type AnalysisResult,
  AnalysisResult as AnalysisResultSchema,
  AppCodeResponse,
  type Connection,
  ConnectionResponse,
  ConnectionsResponse,
  CreateConnectionBody,
  DeleteMeBody,
  type Device,
  DevicesResponse,
  type Finding,
  type HookEvent,
  HookEventsResponse,
  type HookOutcome,
  HookResponse,
  itemKey,
  JsonSourceBody,
  marker,
  normalizeTerm,
  normalizeText,
  PageQuery,
  PasteTranscriptBody,
  PatchConnectionBody,
  PatchMeBody,
  PatchPatternBody,
  PatchWordBody,
  type Pattern,
  PatternResponse,
  PatternsQuery,
  PatternsResponse,
  type Recommendation,
  type RecommendationKind,
  RecommendationResponse,
  RecommendationsPage,
  RecommendationsQuery,
  SignInBody,
  SignUpBody,
  type Source,
  SourcesResponse,
  SpeakerBody,
  TestPushResponse,
  type Transcript,
  type TranscriptDetail,
  TranscriptDetailResponse,
  TranscriptResponse,
  TranscriptsPage,
  type User,
  UserResponse,
  type Word,
  WordResponse,
  WordsQuery,
  WordsResponse,
} from "shared";
import resultNativeText from "shared/fixtures/analysis/result-native-language.json?raw";
import resultOkText from "shared/fixtures/analysis/result-ok.json?raw";
import jamieText from "shared/fixtures/jamie/meeting-completed.json?raw";
import jamieUnknownText from "shared/fixtures/jamie/meeting-completed-unknown-speakers.json?raw";
import jsonText from "shared/fixtures/json/transcript.json?raw";
import pasteText from "shared/fixtures/paste/transcript.txt?raw";
import type { z } from "zod";

const SEED_BASE = "http://localhost:5190";
const COOKIE = "mozol_session";
const DEMO = { email: "demo@mozol.test", password: "mozol-demo-password" };

// ---------- State ----------

type Speaker = TranscriptDetail["speakers"][number];
type Segment = TranscriptDetail["segments"][number];

type Account = { user: User; password: string };
type StoredConnection = {
  userId: string;
  c: Connection;
  token: string;
  secret: string | null;
  events: HookEvent[];
};
type StoredTranscript = {
  userId: string;
  t: Transcript;
  externalId: string | null;
  speakers: Speaker[];
  segments: Segment[];
  analysis: TranscriptDetail["analysis"];
  mockResult: AnalysisResult;
  run: number;
};
type StoredRec = { userId: string; r: Recommendation };
type Seen = { transcriptId: string; count: number };
type StoredPattern = {
  userId: string;
  id: string;
  language: string;
  key: string;
  category: Pattern["category"];
  title: string;
  status: Pattern["status"];
  seen: Seen[];
  latest: Pattern["latest"];
};
type StoredWord = {
  userId: string;
  w: Omit<Word, "timesSuggested" | "firstSeenAt" | "lastSeenAt">;
  seen: Seen[];
};
type StoredDevice = { userId: string; d: Device };

const db = {
  accounts: [] as Account[],
  sessions: new Map<string, string>(),
  connections: [] as StoredConnection[],
  transcripts: [] as StoredTranscript[],
  recs: [] as StoredRec[],
  patterns: [] as StoredPattern[],
  words: [] as StoredWord[],
  devices: [] as StoredDevice[],
};

// ---------- Helpers ----------

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues?: { path: string; code: string }[],
  ) {
    super(code);
  }
}

const now = () => new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function hex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function newId(prefix: string): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(26)), (b) => alphabet[b % 32]);
  return `${prefix}_${chars.join("")}`;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code }));
    throw new HttpError(400, "validation_failed", issues);
  }
  return parsed.data;
}

function json<T extends z.ZodType>(status: number, schema: T, body: z.infer<T>, headers?: Headers): Response {
  const checked = schema.safeParse(body);
  if (!checked.success) {
    console.error("[mock] response does not match its schema", checked.error.issues);
    throw new HttpError(500, "internal");
  }
  const out = new Headers(headers);
  out.set("Content-Type", "application/json");
  return new Response(JSON.stringify(checked.data), { status, headers: out });
}

function empty(status: number, headers?: Headers): Response {
  return new Response(null, { status, headers });
}

function sessionCookie(token: string | null): Headers {
  const value = token
    ? `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`
    : `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  return new Headers({ "Set-Cookie": value });
}

function cookieToken(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

function page<T>(items: T[], query: { limit: number; cursor?: string }) {
  const start = query.cursor ? Number(query.cursor) : 0;
  const slice = items.slice(start, start + query.limit);
  const next = start + query.limit < items.length ? String(start + query.limit) : null;
  return { items: slice, nextCursor: next };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const isPlaceholderName = (name: string) => /^Speaker \d+$/.test(name);

// ---------- Transcripts ----------

function speakersOf(segments: Segment[]): Speaker[] {
  const speakers = new Map<string, Speaker>();
  for (const s of segments) {
    const speaker = speakers.get(s.speakerId) ?? {
      id: s.speakerId,
      name: s.speakerName,
      wordCount: 0,
      firstLines: [],
    };
    speaker.wordCount += wordCount(s.text);
    if (speaker.firstLines.length < 3) speaker.firstLines.push(s.text);
    speakers.set(s.speakerId, speaker);
  }
  return [...speakers.values()];
}

function segmentsFromNames(turns: { speaker: string; text: string }[]): Segment[] {
  const ids = new Map<string, string>();
  return turns
    .filter((t) => t.text.trim() !== "")
    .map((t) => {
      if (!ids.has(t.speaker)) ids.set(t.speaker, `s${ids.size + 1}`);
      return { speakerId: ids.get(t.speaker) as string, speakerName: t.speaker, text: t.text };
    });
}

// Paste format (docs/product/sources.md): "Name: text" starts a turn, other lines continue it, no names = own text.
function parsePaste(text: string, user: User): { kind: Transcript["kind"]; segments: Segment[] } {
  const turns: { speaker: string; text: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([^:\n]{1,80}):\s+(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) turns.push({ speaker: match[1].trim(), text: match[2] });
    else if (turns.length > 0 && line.trim()) {
      const last = turns[turns.length - 1] as { speaker: string; text: string };
      last.text = `${last.text} ${line.trim()}`;
    }
  }
  if (turns.length === 0)
    return { kind: "text", segments: segmentsFromNames([{ speaker: user.displayName, text }]) };
  return { kind: "call", segments: segmentsFromNames(turns) };
}

function learnerFor(user: User, speakers: Speaker[], preferred?: string | null): string | null {
  if (preferred && speakers.some((s) => s.name === preferred)) return preferred;
  const names = user.speakerNames.map((n) => n.toLowerCase());
  return speakers.find((s) => names.includes(s.name.toLowerCase()))?.name ?? null;
}

function addTranscript(
  account: Account,
  input: {
    source: Transcript["source"];
    connectionId: string | null;
    kind: Transcript["kind"];
    title: string | null;
    occurredAt: string;
    durationSec: number | null;
    segments: Segment[];
    externalId?: string | null;
    learner?: string | null;
    mockResult?: AnalysisResult;
  },
): StoredTranscript {
  const speakers = speakersOf(input.segments);
  const learner =
    input.kind === "text" ? (speakers[0]?.name ?? null) : learnerFor(account.user, speakers, input.learner);
  const stored: StoredTranscript = {
    userId: account.user.id,
    t: {
      id: newId("trn"),
      source: input.source,
      connectionId: input.connectionId,
      kind: input.kind,
      title: input.title,
      occurredAt: input.occurredAt,
      durationSec: input.durationSec,
      language: null,
      status: learner ? "queued" : "needs_speaker",
      skipReason: null,
      errorCode: null,
      learnerSpeakerName: learner,
      counts: null,
      createdAt: now(),
    },
    externalId: input.externalId ?? null,
    speakers,
    segments: input.segments,
    analysis: null,
    mockResult: input.mockResult ?? resultOk,
    run: 0,
  };
  db.transcripts.push(stored);
  if (stored.t.status === "queued") scheduleAnalysis(stored);
  return stored;
}

// A queued transcript becomes analyzing after 3 s and analyzed after 8 s.
function scheduleAnalysis(stored: StoredTranscript) {
  const run = ++stored.run;
  stored.t.status = "queued";
  const alive = () => db.transcripts.includes(stored) && stored.run === run;
  setTimeout(() => {
    if (alive()) stored.t.status = "analyzing";
  }, 3000);
  setTimeout(() => {
    if (alive())
      void finishAnalysis(stored, stored.mockResult).catch((e) => console.error("[mock] analysis", e));
  }, 8000);
}

async function finishAnalysis(stored: StoredTranscript, result: AnalysisResult) {
  const t = stored.t;
  t.skipReason = null;
  t.errorCode = null;
  t.language = result.language;
  stored.analysis = {
    id: newId("anl"),
    model: "mock-model",
    promptVersion: "mock-1",
    createdAt: now(),
    result,
  };
  if (result.status !== "ok") {
    t.status = "skipped";
    t.skipReason = result.status;
    t.counts = null;
    return;
  }
  t.counts = {
    findings: result.findings.length,
    words: result.words.length,
    phrases: result.phrases.length,
    rewrites: result.rewrites.length,
  };
  const language = result.language as string;
  for (const f of result.findings) notePattern(stored, language, f);
  for (const w of result.words) noteWord(stored, language, w);
  await addRecommendations(stored, language, result);
  t.status = "analyzed";
}

function noteSeen(seen: Seen[], transcriptId: string, count: number) {
  const entry = seen.find((s) => s.transcriptId === transcriptId);
  if (entry) entry.count = count;
  else seen.push({ transcriptId, count });
}

function notePattern(stored: StoredTranscript, language: string, f: Finding) {
  let p = db.patterns.find(
    (x) => x.userId === stored.userId && x.language === language && x.key === f.patternKey,
  );
  if (!p) {
    p = {
      userId: stored.userId,
      id: newId("pat"),
      language,
      key: f.patternKey,
      category: f.category,
      title: f.title,
      status: "active",
      seen: [],
      latest: { examples: f.examples, explanation: f.explanation, tip: f.tip },
    };
    db.patterns.push(p);
  }
  p.title = f.title;
  p.latest = { examples: f.examples, explanation: f.explanation, tip: f.tip };
  noteSeen(p.seen, stored.t.id, f.occurrences);
}

function noteWord(stored: StoredTranscript, language: string, s: AnalysisResult["words"][number]) {
  const key = normalizeText(s.term);
  let w = db.words.find(
    (x) => x.userId === stored.userId && x.w.language === language && normalizeText(x.w.term) === key,
  );
  if (!w) {
    w = {
      userId: stored.userId,
      w: {
        id: newId("wrd"),
        language,
        term: s.term,
        type: s.type,
        translation: s.translation,
        meaning: s.meaning,
        example: s.example,
        exampleTranslation: s.exampleTranslation,
        status: "new",
      },
      seen: [],
    };
    db.words.push(w);
  }
  noteSeen(w.seen, stored.t.id, 1);
}

function transcriptOf(id: string) {
  return db.transcripts.find((x) => x.t.id === id);
}

function seenTimes(seen: Seen[]) {
  const times = seen.map((s) => transcriptOf(s.transcriptId)?.t.occurredAt).filter((x): x is string => !!x);
  times.sort();
  return { first: times[0] ?? now(), last: times[times.length - 1] ?? now() };
}

function patternOut(p: StoredPattern): Pattern {
  const times = seenTimes(p.seen);
  const sources = [...new Set(p.seen.map((s) => transcriptOf(s.transcriptId)?.t.source).filter((x) => !!x))];
  return {
    id: p.id,
    language: p.language,
    key: p.key,
    category: p.category,
    title: p.title,
    status: p.status,
    recurring: p.seen.length >= 2,
    occurrencesTotal: p.seen.reduce((sum, s) => sum + s.count, 0),
    transcriptsCount: p.seen.length,
    sources: sources as Pattern["sources"],
    firstSeenAt: times.first,
    lastSeenAt: times.last,
    latest: p.latest,
  };
}

function wordOut(w: StoredWord): Word {
  const times = seenTimes(w.seen);
  return { ...w.w, timesSuggested: w.seen.length, firstSeenAt: times.first, lastSeenAt: times.last };
}

// ---------- Recommendations ----------

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 3)}...`);

function itemBlocked(userId: string, language: string, kind: RecommendationKind, key: string): boolean {
  if (kind === "mistake") {
    const p = db.patterns.find((x) => x.userId === userId && x.language === language && x.key === key);
    return p?.status === "dismissed";
  }
  if (kind === "word") {
    const term = key.slice("word:".length);
    const w = db.words.find(
      (x) => x.userId === userId && x.w.language === language && normalizeText(x.w.term) === term,
    );
    return w?.w.status === "known" || w?.w.status === "dismissed";
  }
  return false;
}

async function addRecommendations(stored: StoredTranscript, language: string, result: AnalysisResult) {
  const items: {
    kind: RecommendationKind;
    key: string;
    title: string;
    notes: string;
    embed: string;
    terms: Finding["matchTerms"];
    priority: 1 | 5;
  }[] = [];
  for (const f of result.findings) {
    const example = f.examples[0];
    items.push({
      kind: "mistake",
      key: await itemKey("mistake", f),
      title: f.title,
      notes: [f.explanation, ...f.examples.map((e) => `${e.quote} -> ${e.correction}`), f.tip ?? ""]
        .filter(Boolean)
        .join("\n"),
      embed: example ? `${example.correction} (not "${example.quote}")` : f.title,
      terms: f.matchTerms,
      priority: f.severity === "high" ? 1 : 5,
    });
  }
  for (const w of result.words) {
    items.push({
      kind: "word",
      key: await itemKey("word", w),
      title: w.term,
      notes: `${w.translation}\n${w.meaning}\n\n${w.example}\n${w.exampleTranslation}`,
      embed: `${w.term}: ${w.translation}`,
      terms: w.matchTerms,
      priority: 5,
    });
  }
  for (const p of result.phrases) {
    items.push({
      kind: "phrase",
      key: await itemKey("phrase", p),
      title: p.phrase,
      notes: `${p.useWhen}\n${p.translation}${p.insteadOf ? `\n\nNot: ${p.insteadOf}` : ""}`,
      embed: `${p.phrase}: ${p.translation}`,
      terms: p.matchTerms,
      priority: 5,
    });
  }
  for (const r of result.rewrites) {
    items.push({
      kind: "rewrite",
      key: await itemKey("rewrite", r),
      title: r.rewrite,
      notes: `${r.original}\n-> ${r.rewrite}\n\n${r.note}`,
      embed: r.rewrite,
      terms: r.matchTerms,
      priority: 5,
    });
  }
  for (const item of items) {
    const id = newId("rec");
    const blocked = itemBlocked(stored.userId, language, item.kind, item.key);
    db.recs.push({
      userId: stored.userId,
      r: {
        id,
        transcriptId: stored.t.id,
        language,
        kind: item.kind,
        itemKey: item.key,
        marker: await marker(language, item.key),
        title: clip(item.title, 200),
        notes: item.notes,
        embedLine: clip(item.embed, 200),
        matchTerms: item.terms.map(normalizeTerm),
        url: `${SEED_BASE}/r/${id}`,
        priority: item.priority,
        delivery: blocked ? null : newDelivery("pending"),
        createdAt: now(),
      },
    });
  }
}

function newDelivery(
  status: NonNullable<Recommendation["delivery"]>["status"],
  outcome: NonNullable<Recommendation["delivery"]>["outcome"] = null,
  errorCode: string | null = null,
): NonNullable<Recommendation["delivery"]> {
  return { id: newId("dlv"), status, outcome, errorCode, updatedAt: now() };
}

// ---------- Sources and webhooks ----------

const sources: Source[] = [
  {
    id: "jamie",
    name: "Jamie",
    kind: "call",
    webhook: true,
    setupSteps: [
      "In Jamie open Settings, Developers, Webhooks, and choose Create Webhook.",
      "URL: paste the MOZOL webhook URL of this connection.",
      "Scope: Personal, so only your own meetings are sent.",
      "Authentication: Signature. Jamie shows a signing secret once.",
      "Paste the signing secret into this page. This step is optional: without it the secret URL alone protects the connection.",
      "Press Send Test Event in Jamie. The event appears in the list below.",
    ],
  },
  {
    id: "json",
    name: "Webhook JSON",
    kind: "call",
    webhook: true,
    setupSteps: [
      "Copy the webhook URL of this connection.",
      "Send a POST request with Content-Type application/json and the transcript as the body.",
      "Each segment has a speaker and a text. Set learnerSpeaker to your speaker name when you know it.",
    ],
  },
  { id: "paste", name: "Paste", kind: "text", webhook: false, setupSteps: [] },
];

function addConnection(account: Account, source: Connection["source"], base: string, label?: string) {
  const token = hex(16);
  const stored: StoredConnection = {
    userId: account.user.id,
    token,
    secret: null,
    events: [],
    c: {
      id: newId("con"),
      source,
      label: label ?? (source === "jamie" ? "Jamie" : "Webhook JSON"),
      status: "active",
      webhookUrl: `${base}/api/hooks/${source}/${token}`,
      hasSigningSecret: false,
      lastEventAt: null,
      lastEventOutcome: null,
      lastEventError: null,
      createdAt: now(),
    },
  };
  db.connections.push(stored);
  return stored;
}

function addEvent(
  conn: StoredConnection,
  outcome: HookOutcome,
  sizeBytes: number,
  transcriptId: string | null,
  errorCode: string | null = null,
  receivedAt = now(),
) {
  conn.events.unshift({ id: newId("evt"), receivedAt, outcome, errorCode, sizeBytes, transcriptId });
  conn.events = conn.events.slice(0, 20);
  conn.c.lastEventAt = receivedAt;
  conn.c.lastEventOutcome = outcome;
  conn.c.lastEventError = errorCode;
}

type JamieBody = {
  metadata?: { id?: string };
  data?: {
    title?: string;
    startTime?: string;
    endTime?: string | null;
    user?: { email?: string };
    participants?: { id: string; name: string; email: string | null }[];
    transcript?: { speakerId: string; speakerName: string; text: string }[];
  };
};

function jamieTranscript(
  account: Account,
  body: JamieBody,
  connectionId: string | null,
): StoredTranscript | null {
  const data = body.data;
  const segments = (data?.transcript ?? [])
    .filter((s) => s.text?.trim())
    .map((s) => ({ speakerId: s.speakerId, speakerName: s.speakerName, text: s.text }));
  if (!data || segments.length === 0) return null;
  const recorderEmail = data.user?.email?.toLowerCase();
  const accountEmail = account.user.email.toLowerCase();
  const recorder =
    recorderEmail === accountEmail
      ? data.participants?.find((p) => p.email?.toLowerCase() === accountEmail)?.name
      : undefined;
  const start = data.startTime ? new Date(data.startTime) : new Date();
  const end = data.endTime ? new Date(data.endTime) : null;
  return addTranscript(account, {
    source: "jamie",
    connectionId,
    kind: "call",
    title: data.title ?? null,
    occurredAt: start.toISOString(),
    durationSec: end ? Math.round((end.getTime() - start.getTime()) / 1000) : null,
    segments,
    externalId: body.metadata?.id ?? null,
    learner: recorder ?? null,
  });
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function jamieSignatureOk(secret: string, header: string | null, raw: string): Promise<boolean> {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!parts.t || !parts.v0 || !Number.isFinite(t) || Date.now() / 1000 - t > 7200) return false;
  return (await hmacHex(secret, `${parts.t}.${raw}`)) === parts.v0;
}

async function hook(req: Request, source: string, token: string): Promise<Response> {
  const conn = db.connections.find((x) => x.c.source === source && x.token === token);
  if (!conn) throw new HttpError(404, "hook_not_found");
  const raw = await req.text();
  const size = new TextEncoder().encode(raw).length;
  const refuse = (status: number, code: string): never => {
    addEvent(conn, "refused", size, null, code);
    throw new HttpError(status, code);
  };
  if (conn.c.status === "paused") refuse(403, "hook_paused");
  if (size > 1_000_000) refuse(413, "payload_too_large");
  if (!req.headers.get("content-type")?.startsWith("application/json")) refuse(415, "unsupported_media_type");
  if (conn.secret && !(await jamieSignatureOk(conn.secret, req.headers.get("x-jamie-signature"), raw))) {
    refuse(401, "signature_invalid");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    refuse(400, "bad_json");
  }
  const account = accountById(conn.userId);

  if (source === "jamie") {
    const event = req.headers.get("jamie-event") ?? "meeting.completed";
    if (event !== "meeting.completed") {
      addEvent(conn, "ignored", size, null);
      return json(200, HookResponse, { ok: true, outcome: "ignored" });
    }
    const external = (body as JamieBody).metadata?.id;
    const duplicate =
      external && db.transcripts.find((x) => x.userId === account.user.id && x.externalId === external);
    if (duplicate) {
      addEvent(conn, "duplicate", size, duplicate.t.id);
      return json(200, HookResponse, { ok: true, outcome: "duplicate", transcriptId: duplicate.t.id });
    }
    const stored = jamieTranscript(account, body as JamieBody, conn.c.id);
    if (!stored) return refuse(422, "payload_invalid");
    addEvent(conn, "accepted", size, stored.t.id);
    return json(202, HookResponse, { ok: true, outcome: "accepted", transcriptId: stored.t.id });
  }

  const parsed = JsonSourceBody.safeParse(body);
  if (!parsed.success) return refuse(422, "payload_invalid");
  const data = parsed.data;
  const duplicate =
    data.id && db.transcripts.find((x) => x.userId === account.user.id && x.externalId === data.id);
  if (duplicate) {
    addEvent(conn, "duplicate", size, duplicate.t.id);
    return json(200, HookResponse, { ok: true, outcome: "duplicate", transcriptId: duplicate.t.id });
  }
  const stored = addTranscript(account, {
    source: "json",
    connectionId: conn.c.id,
    kind: data.kind,
    title: data.title ?? null,
    occurredAt: data.occurredAt ?? now(),
    durationSec: null,
    segments: segmentsFromNames(data.segments),
    externalId: data.id ?? null,
    learner: data.learnerSpeaker ?? null,
  });
  addEvent(conn, "accepted", size, stored.t.id);
  return json(202, HookResponse, { ok: true, outcome: "accepted", transcriptId: stored.t.id });
}

// ---------- Accounts ----------

function accountById(id: string): Account {
  const account = db.accounts.find((a) => a.user.id === id);
  if (!account) throw new HttpError(401, "unauthorized");
  return account;
}

function createAccount(input: {
  email: string;
  password: string;
  displayName: string;
  nativeLanguage: string;
  timezone: string;
}): Account {
  const account: Account = {
    password: input.password,
    user: {
      id: newId("usr"),
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      nativeLanguage: input.nativeLanguage,
      speakerNames: [input.displayName],
      timezone: input.timezone,
      reminderSettings: {
        embedInMyReminders: true,
        intensity: "normal",
        activeFrom: "09:00",
        activeTo: "21:00",
      },
      createdAt: now(),
    },
  };
  db.accounts.push(account);
  return account;
}

function startSession(account: Account): Headers {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  db.sessions.set(token, account.user.id);
  return sessionCookie(token);
}

function deleteAccount(userId: string) {
  db.accounts = db.accounts.filter((a) => a.user.id !== userId);
  for (const [token, id] of db.sessions) if (id === userId) db.sessions.delete(token);
  db.connections = db.connections.filter((x) => x.userId !== userId);
  db.transcripts = db.transcripts.filter((x) => x.userId !== userId);
  db.recs = db.recs.filter((x) => x.userId !== userId);
  db.patterns = db.patterns.filter((x) => x.userId !== userId);
  db.words = db.words.filter((x) => x.userId !== userId);
  db.devices = db.devices.filter((x) => x.userId !== userId);
}

// ---------- Routes ----------

type Ctx = { req: Request; url: URL; params: string[]; account: () => Account; body: () => Promise<unknown> };
type Handler = (ctx: Ctx) => Promise<Response> | Response;

function owned<T extends { userId: string }>(list: T[], userId: string, find: (x: T) => boolean): T {
  const item = list.find((x) => x.userId === userId && find(x));
  if (!item) throw new HttpError(404, "not_found");
  return item;
}

function transcriptDetail(stored: StoredTranscript): TranscriptDetail {
  return {
    ...stored.t,
    speakers: stored.speakers,
    segments: stored.segments,
    analysis: stored.analysis,
    recommendations: db.recs.filter((x) => x.r.transcriptId === stored.t.id).map((x) => x.r),
  };
}

const busy = (t: Transcript) => t.status === "queued" || t.status === "analyzing";

const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/health$/, () => new Response(JSON.stringify({ ok: true }), { status: 200 })],

  // Accounts
  [
    "POST",
    /^\/api\/auth\/sign-up$/,
    async ({ body }) => {
      const input = parse(SignUpBody, await body());
      if (db.accounts.some((a) => a.user.email === input.email.toLowerCase()))
        throw new HttpError(409, "email_taken");
      const account = createAccount(input);
      return json(201, UserResponse, { user: account.user }, startSession(account));
    },
  ],
  [
    "POST",
    /^\/api\/auth\/sign-in$/,
    async ({ body }) => {
      const input = parse(SignInBody, await body());
      const account = db.accounts.find((a) => a.user.email === input.email.toLowerCase());
      if (!account || account.password !== input.password) throw new HttpError(401, "invalid_credentials");
      return json(200, UserResponse, { user: account.user }, startSession(account));
    },
  ],
  [
    "POST",
    /^\/api\/auth\/sign-out$/,
    ({ req, account }) => {
      account();
      const token = cookieToken(req);
      if (token) db.sessions.delete(token);
      return empty(204, sessionCookie(null));
    },
  ],
  [
    "POST",
    /^\/api\/auth\/app-code$/,
    ({ account }) => {
      account();
      const code = base64url(crypto.getRandomValues(new Uint8Array(32)));
      return json(201, AppCodeResponse, { code, expiresAt: new Date(Date.now() + 120_000).toISOString() });
    },
  ],
  ["GET", /^\/api\/me$/, ({ account }) => json(200, UserResponse, { user: account().user })],
  [
    "PATCH",
    /^\/api\/me$/,
    async ({ account, body }) => {
      const a = account();
      const input = parse(PatchMeBody, await body());
      a.user = { ...a.user, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
      return json(200, UserResponse, { user: a.user });
    },
  ],
  [
    "DELETE",
    /^\/api\/me$/,
    async ({ account, body }) => {
      const a = account();
      const input = parse(DeleteMeBody, await body());
      if (input.password !== a.password) throw new HttpError(401, "invalid_credentials");
      deleteAccount(a.user.id);
      return empty(204, sessionCookie(null));
    },
  ],

  // Sources and connections
  [
    "GET",
    /^\/api\/sources$/,
    ({ account }) => {
      account();
      return json(200, SourcesResponse, { sources });
    },
  ],
  [
    "GET",
    /^\/api\/connections$/,
    ({ account }) => {
      const id = account().user.id;
      const connections = db.connections.filter((x) => x.userId === id).map((x) => x.c);
      return json(200, ConnectionsResponse, { connections });
    },
  ],
  [
    "POST",
    /^\/api\/connections$/,
    async ({ account, body, url }) => {
      const input = parse(CreateConnectionBody, await body());
      const stored = addConnection(account(), input.source, url.origin, input.label);
      return json(201, ConnectionResponse, { connection: stored.c });
    },
  ],
  [
    "PATCH",
    /^\/api\/connections\/([^/]+)$/,
    async ({ account, body, params }) => {
      const conn = owned(db.connections, account().user.id, (x) => x.c.id === params[0]);
      const input = parse(PatchConnectionBody, await body());
      if (input.label !== undefined) conn.c.label = input.label;
      if (input.status !== undefined) conn.c.status = input.status;
      if (input.signingSecret !== undefined) conn.secret = input.signingSecret;
      conn.c.hasSigningSecret = conn.secret !== null;
      return json(200, ConnectionResponse, { connection: conn.c });
    },
  ],
  [
    "POST",
    /^\/api\/connections\/([^/]+)\/rotate$/,
    ({ account, params, url }) => {
      const conn = owned(db.connections, account().user.id, (x) => x.c.id === params[0]);
      conn.token = hex(16);
      conn.c.webhookUrl = `${url.origin}/api/hooks/${conn.c.source}/${conn.token}`;
      return json(200, ConnectionResponse, { connection: conn.c });
    },
  ],
  [
    "DELETE",
    /^\/api\/connections\/([^/]+)$/,
    ({ account, params }) => {
      const conn = owned(db.connections, account().user.id, (x) => x.c.id === params[0]);
      db.connections = db.connections.filter((x) => x !== conn);
      for (const x of db.transcripts) if (x.t.connectionId === conn.c.id) x.t.connectionId = null;
      return empty(204);
    },
  ],
  [
    "GET",
    /^\/api\/connections\/([^/]+)\/events$/,
    ({ account, params }) => {
      const conn = owned(db.connections, account().user.id, (x) => x.c.id === params[0]);
      return json(200, HookEventsResponse, { events: conn.events });
    },
  ],

  // Transcripts
  [
    "POST",
    /^\/api\/transcripts$/,
    async ({ account, body }) => {
      const a = account();
      const input = parse(PasteTranscriptBody, await body());
      const { kind, segments } = parsePaste(input.text, a.user);
      const stored = addTranscript(a, {
        source: "paste",
        connectionId: null,
        kind,
        title: input.title ?? null,
        occurredAt: input.occurredAt ?? now(),
        durationSec: null,
        segments,
      });
      return json(201, TranscriptResponse, { transcript: stored.t });
    },
  ],
  [
    "GET",
    /^\/api\/transcripts$/,
    ({ account, url }) => {
      const id = account().user.id;
      const query = parse(PageQuery, Object.fromEntries(url.searchParams));
      const items = db.transcripts
        .filter((x) => x.userId === id)
        .map((x) => x.t)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      return json(200, TranscriptsPage, page(items, query));
    },
  ],
  [
    "GET",
    /^\/api\/transcripts\/([^/]+)$/,
    ({ account, params }) => {
      const stored = owned(db.transcripts, account().user.id, (x) => x.t.id === params[0]);
      return json(200, TranscriptDetailResponse, { transcript: transcriptDetail(stored) });
    },
  ],
  [
    "POST",
    /^\/api\/transcripts\/([^/]+)\/speaker$/,
    async ({ account, body, params }) => {
      const a = account();
      const stored = owned(db.transcripts, a.user.id, (x) => x.t.id === params[0]);
      const input = parse(SpeakerBody, await body());
      if (busy(stored.t)) throw new HttpError(409, "transcript_busy");
      const speaker = stored.speakers.find((s) => s.id === input.speakerId);
      if (!speaker)
        throw new HttpError(400, "validation_failed", [{ path: "speakerId", code: "invalid_value" }]);
      stored.t.learnerSpeakerName = speaker.name;
      const names = a.user.speakerNames;
      if (!isPlaceholderName(speaker.name) && !names.includes(speaker.name) && names.length < 10) {
        a.user = { ...a.user, speakerNames: [...names, speaker.name] };
      }
      scheduleAnalysis(stored);
      return json(200, TranscriptResponse, { transcript: stored.t });
    },
  ],
  [
    "POST",
    /^\/api\/transcripts\/([^/]+)\/analyze$/,
    ({ account, params }) => {
      const stored = owned(db.transcripts, account().user.id, (x) => x.t.id === params[0]);
      if (busy(stored.t)) throw new HttpError(409, "transcript_busy");
      if (stored.t.learnerSpeakerName) scheduleAnalysis(stored);
      else stored.t.status = "needs_speaker";
      return json(202, TranscriptResponse, { transcript: stored.t });
    },
  ],
  [
    "DELETE",
    /^\/api\/transcripts\/([^/]+)$/,
    ({ account, params }) => {
      const stored = owned(db.transcripts, account().user.id, (x) => x.t.id === params[0]);
      db.transcripts = db.transcripts.filter((x) => x !== stored);
      for (const x of db.recs) if (x.r.transcriptId === stored.t.id) x.r.transcriptId = null;
      for (const p of db.patterns) p.seen = p.seen.filter((s) => s.transcriptId !== stored.t.id);
      for (const w of db.words) w.seen = w.seen.filter((s) => s.transcriptId !== stored.t.id);
      return empty(204);
    },
  ],

  // Patterns and words
  [
    "GET",
    /^\/api\/patterns$/,
    ({ account, url }) => {
      const id = account().user.id;
      const query = parse(PatternsQuery, Object.fromEntries(url.searchParams));
      const patterns = db.patterns
        .filter((p) => p.userId === id && p.seen.length > 0 && p.status === query.status)
        .filter((p) => !query.language || p.language === query.language)
        .map(patternOut)
        .sort(
          (a, b) => Number(b.recurring) - Number(a.recurring) || b.lastSeenAt.localeCompare(a.lastSeenAt),
        );
      return json(200, PatternsResponse, { patterns });
    },
  ],
  [
    "PATCH",
    /^\/api\/patterns\/([^/]+)$/,
    async ({ account, body, params }) => {
      const p = owned(db.patterns, account().user.id, (x) => x.id === params[0]);
      p.status = parse(PatchPatternBody, await body()).status;
      return json(200, PatternResponse, { pattern: patternOut(p) });
    },
  ],
  [
    "GET",
    /^\/api\/words$/,
    ({ account, url }) => {
      const id = account().user.id;
      const query = parse(WordsQuery, Object.fromEntries(url.searchParams));
      const words = db.words
        .filter((w) => w.userId === id && w.seen.length > 0 && w.w.status === query.status)
        .filter((w) => !query.language || w.w.language === query.language)
        .map(wordOut)
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
      return json(200, WordsResponse, { words });
    },
  ],
  [
    "PATCH",
    /^\/api\/words\/([^/]+)$/,
    async ({ account, body, params }) => {
      const w = owned(db.words, account().user.id, (x) => x.w.id === params[0]);
      w.w.status = parse(PatchWordBody, await body()).status;
      return json(200, WordResponse, { word: wordOut(w) });
    },
  ],

  // Devices
  [
    "GET",
    /^\/api\/devices$/,
    ({ account }) => {
      const id = account().user.id;
      return json(200, DevicesResponse, {
        devices: db.devices.filter((x) => x.userId === id).map((x) => x.d),
      });
    },
  ],
  [
    "POST",
    /^\/api\/devices\/([^/]+)\/test-push$/,
    ({ account, params }) => {
      owned(db.devices, account().user.id, (x) => x.d.installationId === params[0]);
      return json(202, TestPushResponse, { ok: true });
    },
  ],

  // Recommendations
  [
    "GET",
    /^\/api\/recommendations$/,
    ({ account, url }) => {
      const id = account().user.id;
      const query = parse(RecommendationsQuery, Object.fromEntries(url.searchParams));
      const items = db.recs
        .filter((x) => x.userId === id)
        .filter((x) => query.delivered === undefined || (x.r.delivery !== null) === query.delivered)
        .map((x) => x.r)
        .reverse();
      return json(200, RecommendationsPage, page(items, query));
    },
  ],
  [
    "GET",
    /^\/api\/recommendations\/([^/]+)$/,
    ({ account, params }) => {
      const rec = owned(db.recs, account().user.id, (x) => x.r.id === params[0]);
      return json(200, RecommendationResponse, { recommendation: rec.r });
    },
  ],
  [
    "POST",
    /^\/api\/recommendations\/([^/]+)\/deliver$/,
    ({ account, params }) => {
      const rec = owned(db.recs, account().user.id, (x) => x.r.id === params[0]);
      rec.r.delivery = newDelivery("pending");
      return json(202, RecommendationResponse, { recommendation: rec.r });
    },
  ],
];

// ---------- Seed ----------

const resultOk = AnalysisResultSchema.parse(JSON.parse(resultOkText));
const resultNative = AnalysisResultSchema.parse(JSON.parse(resultNativeText));

// The second English call repeats three mistakes and two words, so they become recurring.
const resultOkRepeat = AnalysisResultSchema.parse({
  ...resultOk,
  findings: resultOk.findings.slice(1, 4).map((f) => ({ ...f, occurrences: 1 })),
  words: resultOk.words.slice(0, 2),
  phrases: [],
  rewrites: [],
});

const resultGerman = AnalysisResultSchema.parse({
  status: "ok",
  language: "de",
  summary: {
    overview: "Вы понятно объясняете план на неделю. Чаще всего путается порядок слов после «weil».",
    estimatedLevel: "A2",
    strengths: ["Уверенно договариваетесь о времени"],
    focus: "После «weil» ставить глагол в конец.",
  },
  findings: [
    {
      patternKey: "grammar.word_order.verb_final_after_weil",
      category: "grammar",
      title: "Порядок слов после weil",
      severity: "high",
      occurrences: 3,
      examples: [{ quote: "weil ich habe keine Zeit", correction: "weil ich keine Zeit habe" }],
      explanation: "В придаточном предложении с weil спрягаемый глагол стоит в конце.",
      tip: "Скажите про себя: weil ... habe.",
      matchTerms: [{ text: "weil", lang: "de", mode: "word" }],
    },
    {
      patternKey: "grammar.articles.missing_or_wrong",
      category: "grammar",
      title: "Род существительного",
      severity: "medium",
      occurrences: 2,
      examples: [{ quote: "der Problem", correction: "das Problem" }],
      explanation: "Problem — среднего рода.",
      tip: null,
      matchTerms: [{ text: "problem", lang: "de", mode: "word" }],
    },
  ],
  words: [
    {
      term: "der Termin",
      type: "word",
      reason: "better_choice",
      learnerSaid: "das Meeting",
      translation: "встреча, назначенное время",
      meaning: "Так называют любую договорённую встречу: у врача, с клиентом, с коллегами.",
      example: "Ich habe morgen um zehn einen Termin.",
      exampleTranslation: "У меня завтра в десять встреча.",
      matchTerms: [{ text: "termin", lang: "de", mode: "word" }],
    },
  ],
  phrases: [
    {
      phrase: "Das passt mir gut",
      useWhen: "Когда соглашаетесь на предложенное время",
      translation: "Мне это подходит",
      insteadOf: "Das ist gut für mich",
      matchTerms: [{ text: "passt mir", lang: "de", mode: "phrase" }],
    },
  ],
  rewrites: [
    {
      original: "Ich kann nicht kommen am Montag weil ich habe einen Arzttermin",
      rewrite: "Ich kann am Montag nicht kommen, weil ich einen Arzttermin habe.",
      note: "Время ставится перед nicht, а глагол после weil уходит в конец.",
      matchTerms: [],
    },
  ],
});

const germanSegments = segmentsFromNames([
  { speaker: "Anna Schneider", text: "Guten Morgen! Wann hast du diese Woche Zeit?" },
  { speaker: "Petr", text: "Ich kann nicht kommen am Montag weil ich habe einen Arzttermin." },
  { speaker: "Anna Schneider", text: "Kein Problem. Und am Dienstag um zehn?" },
  { speaker: "Petr", text: "Ja, das ist gut für mich. Wir können der Problem mit dem Checkout besprechen." },
]);

async function seed() {
  const a = createAccount({
    email: DEMO.email,
    password: DEMO.password,
    displayName: "Petr",
    nativeLanguage: "ru",
    timezone: "Europe/Berlin",
  });
  a.user = { ...a.user, speakerNames: ["Petr", "Petr Ivanov"], createdAt: ago(60 * 24 * 7) };

  const jamie = addConnection(a, "jamie", SEED_BASE, "Jamie, work");
  const hook = addConnection(a, "json", SEED_BASE, "Slack export");
  jamie.secret = "demo-secret";
  jamie.c.hasSigningSecret = true;

  const base = { connectionId: null, durationSec: null } as const;
  const make = (input: Parameters<typeof addTranscript>[1]) => {
    const stored = addTranscript(a, input);
    stored.run++; // seeded transcripts get their final state below, not from the timer
    return stored;
  };

  const t1 = make({
    ...base,
    source: "jamie",
    connectionId: jamie.c.id,
    kind: "call",
    title: "Quarterly review with Maria",
    occurredAt: ago(60 * 50),
    durationSec: 1860,
    segments: parsePaste(pasteText, a.user).segments,
  });
  await finishAnalysis(t1, resultOk);

  const jsonBody = JsonSourceBody.parse(JSON.parse(jsonText));
  const t2 = make({
    ...base,
    source: "json",
    connectionId: hook.c.id,
    kind: jsonBody.kind,
    title: jsonBody.title ?? null,
    occurredAt: ago(60 * 26),
    segments: segmentsFromNames(jsonBody.segments),
    externalId: jsonBody.id,
    learner: jsonBody.learnerSpeaker,
  });
  await finishAnalysis(t2, resultOkRepeat);

  const t3 = make({
    ...base,
    source: "paste",
    kind: "call",
    title: "Termin mit Anna",
    occurredAt: ago(60 * 20),
    segments: germanSegments,
    mockResult: resultGerman,
  });
  await finishAnalysis(t3, resultGerman);

  const unknown = JSON.parse(jamieUnknownText) as JamieBody;
  const t4 = jamieTranscript(a, unknown, jamie.c.id);
  if (!t4) throw new Error("the unknown-speakers fixture has no segments");
  t4.run++;
  t4.t.occurredAt = ago(60 * 3);

  const t5 = make({
    ...base,
    source: "paste",
    kind: "text",
    title: "Quick note",
    occurredAt: ago(60 * 10),
    segments: segmentsFromNames([{ speaker: "Petr", text: "Thanks, see you tomorrow." }]),
  });
  t5.t.status = "skipped";
  t5.t.skipReason = "too_short";

  const t6 = make({
    ...base,
    source: "json",
    connectionId: hook.c.id,
    kind: "chat",
    title: "#general: release notes",
    occurredAt: ago(60 * 30),
    segments: segmentsFromNames([
      { speaker: "Petr", text: "I have wrote the release notes, please check them until evening." },
      { speaker: "Laura Bennett", text: "Will do!" },
    ]),
  });
  t6.t.status = "failed";
  t6.t.errorCode = "analysis_failed";

  const t7 = make({
    ...base,
    source: "jamie",
    connectionId: jamie.c.id,
    kind: "call",
    title: "Созвон с командой",
    occurredAt: ago(60 * 40),
    durationSec: 900,
    segments: segmentsFromNames([
      { speaker: "Petr", text: "Давайте начнём с планов на неделю." },
      { speaker: "Ivan", text: "Да, у меня всё готово." },
    ]),
  });
  await finishAnalysis(t7, resultNative);

  // Statuses the user already set, then delivery states of every kind on the first call.
  const pattern = (key: string) => db.patterns.find((p) => p.key === key && p.language === "en");
  const word = (term: string) => db.words.find((w) => w.w.term === term);
  const learned = pattern("register.outdated_term.handicapped");
  const dismissed = pattern("vocabulary.false_friend.actual");
  if (learned) learned.status = "learned";
  if (dismissed) dismissed.status = "dismissed";
  const known = word("accessibility");
  const learning = word("push back");
  const dismissedWord = word("crucial");
  if (known) known.w.status = "known";
  if (learning) learning.w.status = "learning";
  if (dismissedWord) dismissedWord.w.status = "dismissed";

  const states: (NonNullable<Recommendation["delivery"]> | null)[] = [
    newDelivery("applied", "embedded"),
    newDelivery("applied", "created"),
    newDelivery("applied", "reminder_updated"),
    newDelivery("applied", "embed_updated"),
    newDelivery("pending"),
    newDelivery("claimed"),
    newDelivery("failed", null, "reminders_denied"),
  ];
  const firstCall = db.recs.filter((x) => x.r.transcriptId === t1.t.id);
  firstCall.forEach((x, i) => {
    const blocked = itemBlocked(a.user.id, x.r.language, x.r.kind, x.r.itemKey);
    x.r.delivery = blocked ? null : (states[i] ?? newDelivery("applied", "created"));
  });
  for (const x of db.recs) {
    if (x.r.transcriptId !== t1.t.id && itemBlocked(a.user.id, x.r.language, x.r.kind, x.r.itemKey)) {
      x.r.delivery = null;
    }
  }

  addEvent(jamie, "accepted", jamieText.length, t1.t.id, null, ago(60 * 50));
  addEvent(jamie, "refused", 1204, null, "signature_invalid", ago(60 * 45));
  addEvent(jamie, "ignored", 312, null, null, ago(60 * 41));
  addEvent(jamie, "accepted", jamieText.length, t7.t.id, null, ago(60 * 40));
  addEvent(jamie, "duplicate", jamieText.length, t7.t.id, null, ago(60 * 39));
  addEvent(jamie, "accepted", jamieUnknownText.length, t4.t.id, null, ago(60 * 3));
  addEvent(hook, "accepted", jsonText.length, t2.t.id, null, ago(60 * 26));
  addEvent(hook, "refused", 88, null, "payload_invalid", ago(60 * 25));
  addEvent(hook, "accepted", 402, t6.t.id, null, ago(60 * 30));

  db.devices.push({
    userId: a.user.id,
    d: {
      id: newId("dev"),
      installationId: "demo-install-3f2a9c1e",
      platform: "ios",
      appVersion: "1.0 (12)",
      osVersion: "26.1",
      pushEnabled: true,
      remindersAccess: "full",
      notificationsAccess: "authorized",
      lastSeenAt: ago(12),
    },
  });
}

const ready = seed();

// ---------- Entry ----------

// Answers one /api request. Errors become { error, issues? } with their status; the console gets one line.
export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rid = req.headers.get("x-request-id") ?? hex(6);
  let response: Response;
  try {
    await ready;
    response = await route(req, url);
  } catch (error) {
    const e = error instanceof HttpError ? error : new HttpError(500, "internal");
    if (!(error instanceof HttpError)) console.error("[mock] unexpected error", error);
    const body = e.issues ? { error: e.code, issues: e.issues } : { error: e.code };
    response = new Response(JSON.stringify(body), {
      status: e.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  response.headers.set("X-Request-Id", rid);
  console.log(`[mock] ${req.method} ${url.pathname} ${response.status} rid=${rid}`);
  return response;
}

async function route(req: Request, url: URL): Promise<Response> {
  const hookMatch = /^\/api\/hooks\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (hookMatch && req.method === "POST") return hook(req, hookMatch[1] as string, hookMatch[2] as string);

  for (const [method, pattern, handler] of routes) {
    const match = pattern.exec(url.pathname);
    if (!match || method !== req.method) continue;
    const token = cookieToken(req);
    // Cookie requests other than GET must come from the site itself (shared/CONTRACT.md, Authentication).
    if (token && req.method !== "GET" && req.headers.get("origin") !== url.origin) {
      throw new HttpError(403, "forbidden");
    }
    return handler({
      req,
      url,
      params: match.slice(1),
      account: () => {
        const userId = token ? db.sessions.get(token) : undefined;
        if (!userId) throw new HttpError(401, "unauthorized");
        return accountById(userId);
      },
      body: async () => {
        const text = await req.text();
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          throw new HttpError(400, "bad_json");
        }
      },
    });
  }
  throw new HttpError(404, "not_found");
}

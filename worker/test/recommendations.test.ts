import { introspectWorkflow } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  AnalysisResult,
  ClaimResponse,
  marker,
  RecommendationResponse,
  RecommendationsPage,
  ResultsResponse,
} from "shared";
import resultOk from "shared/fixtures/analysis/result-ok.json";
import meeting from "shared/fixtures/jamie/meeting-completed.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { participantsColumn, segmentsColumn } from "../src/db/transcripts";
import { newId } from "../src/ids";
import { startAnalysis } from "../src/pipeline/start";
import { storeResult } from "../src/pipeline/store";
import { recommend } from "../src/recommendations/apply";
import { jamieAdapter } from "../src/sources/jamie";
import { appToken, call, expectError, signUp } from "./helpers";
import { putDevice } from "./push-helpers";

const OK = AnalysisResult.parse(resultOk);

const parsed = jamieAdapter.parse(JSON.stringify(meeting), new Headers(), {
  receivedAt: "2026-10-24T12:00:00.000Z",
  userName: "Petr",
});
if (parsed.outcome !== "transcript") throw new Error("the Jamie fixture is not a transcript");
const SEGMENTS = parsed.transcript.segments;
const PETR = SEGMENTS.find((s) => s.speakerName === "Petr Ivanov")?.speakerId ?? "";

async function rows<T>(sql: string, ...binds: unknown[]): Promise<T[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<T>()
  ).results;
}

// A transcript row with the given result stored as the analysis of its run, as the workflow leaves it before
// the recommend step.
async function stored(userId: string, result = OK, occurredAt = "2026-10-22T09:00:00.000Z"): Promise<string> {
  const id = newId("trn");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO transcripts (id, user_id, source, kind, occurred_at, participants, segments, learner_speaker_id,
       learner_word_count, status, run, created_at, updated_at)
     VALUES (?, ?, 'jamie', 'call', ?, ?, ?, ?, 300, 'analyzing', 1, ?, ?)`,
  )
    .bind(id, userId, occurredAt, participantsColumn([]), segmentsColumn(SEGMENTS), PETR, now, now)
    .run();
  await analyze(id, userId, 1, result);
  return id;
}

async function analyze(transcriptId: string, userId: string, run: number, result: AnalysisResult) {
  await env.DB.prepare("UPDATE transcripts SET run = ?, status = 'analyzing' WHERE id = ?")
    .bind(run, transcriptId)
    .run();
  await env.DB.prepare(
    `INSERT INTO analyses (id, transcript_id, user_id, run, prompt_version, model, status, language, result,
       input_tokens, output_tokens, cache_read_tokens, duration_ms, unmatched_quotes, created_at)
     VALUES (?, ?, ?, ?, 'analysis-v2', 'fixture', ?, ?, ?, 0, 0, 0, 0, 0, ?)
     ON CONFLICT (transcript_id) DO UPDATE SET run = excluded.run, status = excluded.status,
       language = excluded.language, result = excluded.result`,
  )
    .bind(
      newId("ana"),
      transcriptId,
      userId,
      run,
      result.status,
      result.language,
      JSON.stringify(result),
      "2026-10-24T12:00:00.000Z",
    )
    .run();
  expect((await storeResult(env, transcriptId, run)).outcome).toBe("stored");
}

type RecRow = { id: string; item_key: string; marker: string; rank: number };
const recsOf = (transcriptId: string) =>
  rows<RecRow>(
    "SELECT id, item_key, marker, rank FROM recommendations WHERE transcript_id = ? ORDER BY rank, id",
    transcriptId,
  );

type DlvRow = { id: string; recommendation_id: string; marker: string; status: string };
const deliveriesOf = (userId: string) =>
  rows<DlvRow>(
    "SELECT id, recommendation_id, marker, status FROM deliveries WHERE user_id = ? ORDER BY created_at, id",
    userId,
  );

const ORDER = [
  "grammar.articles.missing_or_wrong",
  "grammar.tenses.present_perfect_with_past_time",
  "word:make a decision",
  "word:crucial",
  "word:people with disabilities",
  "vocabulary.false_friend.actual",
];

describe("recommend", () => {
  it("gives the fixture result 6 recommendations in delivery order and 6 pending deliveries", async () => {
    const { user } = await signUp();
    const id = await stored(user.id);
    expect(await recommend(env, id, 1)).toEqual({
      outcome: "analyzed",
      userId: user.id,
      recommendations: 6,
      deliveries: 6,
      pending: 6,
    });
    const recs = await recsOf(id);
    expect(recs.map((r) => [r.item_key, r.rank])).toEqual([
      [ORDER[0], 1],
      [ORDER[1], 2],
      [ORDER[2], 3],
      [ORDER[3], 4],
      [ORDER[4], 5],
      [ORDER[5], 6],
    ]);
    for (const r of recs) expect(r.marker).toBe(await marker("en", r.item_key));
    const deliveries = await deliveriesOf(user.id);
    expect(deliveries.map((d) => d.status)).toEqual(Array(6).fill("pending"));
    expect(new Set(deliveries.map((d) => d.recommendation_id))).toEqual(new Set(recs.map((r) => r.id)));
    const [t] = await rows<{ status: string; analyzed_at: string | null }>(
      "SELECT status, analyzed_at FROM transcripts WHERE id = ?",
      id,
    );
    expect(t?.status).toBe("analyzed");
    expect(t?.analyzed_at).not.toBeNull();

    const [content] = await rows<{ content: string; match_terms: string }>(
      "SELECT content, match_terms FROM recommendations WHERE transcript_id = ? AND item_key = ?",
      id,
      "word:make a decision",
    );
    expect(JSON.parse(content?.content ?? "")).toEqual(OK.words[0]);
  });

  it("running twice changes nothing and makes no new deliveries", async () => {
    const { user } = await signUp();
    const id = await stored(user.id);
    await recommend(env, id, 1);
    const before = (await recsOf(id)).filter((r) => r.rank > 0);
    expect(await recommend(env, id, 1)).toMatchObject({ recommendations: 0, deliveries: 0, pending: 6 });
    expect(await recsOf(id)).toEqual(before);
    expect(await deliveriesOf(user.id)).toHaveLength(6);
  });

  it("gives a dismissed pattern and a known word recommendations without deliveries; a later transcript supersedes pending deliveries of the same markers", async () => {
    const { user } = await signUp();
    const first = await stored(user.id);
    await recommend(env, first, 1);
    await env.DB.prepare("UPDATE patterns SET status = 'dismissed' WHERE user_id = ? AND key = ?")
      .bind(user.id, ORDER[0])
      .run();
    await env.DB.prepare("UPDATE words SET status = 'known' WHERE user_id = ? AND word_key = 'crucial'")
      .bind(user.id)
      .run();

    const second = await stored(user.id, OK, "2026-10-23T09:00:00.000Z");
    expect(await recommend(env, second, 1)).toMatchObject({ recommendations: 6, deliveries: 4, pending: 6 });
    const firstRecs = await recsOf(first);
    const secondRecs = await recsOf(second);
    const markers = (recs: RecRow[]) => recs.map((r) => [r.item_key, r.marker]).sort();
    expect(markers(secondRecs)).toEqual(markers(firstRecs));
    // The articles pattern is now recurring and still high: rank 1.
    expect(secondRecs.map((r) => r.item_key)).toEqual([
      ORDER[0],
      ORDER[1],
      "vocabulary.false_friend.actual",
      ORDER[2],
      ORDER[3],
      ORDER[4],
    ]);

    const byRec = new Map((await deliveriesOf(user.id)).map((d) => [d.recommendation_id, d.status]));
    const status = (recs: RecRow[], key: string) => byRec.get(recs.find((r) => r.item_key === key)?.id ?? "");
    expect(ORDER.map((k) => [k, status(firstRecs, k), status(secondRecs, k)])).toEqual([
      [ORDER[0], "pending", undefined],
      [ORDER[1], "superseded", "pending"],
      [ORDER[2], "superseded", "pending"],
      [ORDER[3], "pending", undefined],
      [ORDER[4], "superseded", "pending"],
      [ORDER[5], "superseded", "pending"],
    ]);
  });

  it("on a re-run keeps delivered recommendations, replaces undelivered ones and delivers only new ones", async () => {
    const { user } = await signUp();
    const id = await stored(user.id);
    await env.DB.prepare("UPDATE patterns SET status = 'dismissed' WHERE user_id = ? AND key = ?")
      .bind(user.id, ORDER[5])
      .run();
    expect(await recommend(env, id, 1)).toMatchObject({ recommendations: 6, deliveries: 5 });
    const before = await recsOf(id);

    const changed = AnalysisResult.parse({
      ...OK,
      words: [
        OK.words[0],
        OK.words[1],
        { ...OK.words[0], term: "reach a decision", matchTerms: OK.words[0]?.matchTerms },
      ],
    });
    await analyze(id, user.id, 2, changed);
    expect(await recommend(env, id, 2)).toMatchObject({ recommendations: 2, deliveries: 1 });
    const after = await recsOf(id);
    const ids = (recs: RecRow[]) => new Map(recs.map((r) => [r.item_key, r.id]));
    const [old, now] = [ids(before), ids(after)];
    for (const key of ORDER.slice(0, 5)) expect(now.get(key)).toBe(old.get(key));
    const actual = "vocabulary.false_friend.actual";
    expect(now.get(actual)).toBeDefined();
    expect(now.get(actual)).not.toBe(old.get(actual));
    expect(now.has("word:reach a decision")).toBe(true);
    expect(await deliveriesOf(user.id)).toHaveLength(6);
  });

  it("ends stale when the transcript's run changed", async () => {
    const { user } = await signUp();
    const id = await stored(user.id);
    expect(await recommend(env, id, 2)).toEqual({ outcome: "stale" });
    expect(await recsOf(id)).toEqual([]);
  });
});

// A user with two signed-in app installations, both registered as devices, and the fixture's 6 deliveries.
async function phones() {
  const { user, cookie } = await signUp();
  const a = await appToken(cookie, `inst-a-${crypto.randomUUID().slice(0, 8)}`);
  const b = await appToken(cookie, `inst-b-${crypto.randomUUID().slice(0, 8)}`);
  const [installA, installB] = await rows<{ installation_id: string }>(
    "SELECT installation_id FROM sessions WHERE user_id = ? AND kind = 'app' ORDER BY installation_id",
    user.id,
  ).then((r) => r.map((s) => s.installation_id));
  if (installA === undefined || installB === undefined) throw new Error("phones: no installations");
  await putDevice({ bearer: a }, installA);
  await putDevice({ bearer: b }, installB);
  const transcriptId = await stored(user.id);
  await recommend(env, transcriptId, 1);
  return { user, cookie, transcriptId, a: { bearer: a, id: installA }, b: { bearer: b, id: installB } };
}

async function claim(phone: { bearer: string; id: string }, limit?: number) {
  const res = await call("/api/deliveries/claim", {
    bearer: phone.bearer,
    body: { installationId: phone.id, limit },
  });
  expect(res.status).toBe(200);
  return ClaimResponse.parse(await res.json());
}

async function report(phone: { bearer: string; id: string }, results: unknown[]) {
  const res = await call("/api/deliveries/results", {
    bearer: phone.bearer,
    body: { installationId: phone.id, results },
  });
  expect(res.status).toBe(200);
  return ResultsResponse.parse(await res.json()).accepted;
}

async function endLease(userId: string) {
  await env.DB.prepare("UPDATE deliveries SET claimed_until = ? WHERE user_id = ? AND status = 'claimed'")
    .bind("2026-01-01T00:00:00.000Z", userId)
    .run();
}

describe("POST /api/deliveries/claim and /results", () => {
  it("hands a delivery to one installation only, and to another after the lease ends", async () => {
    const { user, a, b } = await phones();
    const first = await claim(a);
    expect(first.leaseSeconds).toBe(120);
    expect(first.embedInMyReminders).toBe(true);
    expect(first.deliveries.map((d) => d.recommendation.itemKey)).toEqual(ORDER);
    expect(first.deliveries[0]?.recommendation).toMatchObject({
      kind: "mistake",
      title: "It is a good idea",
      url: expect.stringMatching(/\/r\/rec_/),
      priority: 0,
    });
    expect(first.deliveries[0]).not.toHaveProperty("schedule");
    expect((await claim(b)).deliveries).toEqual([]);
    expect((await claim(a)).deliveries).toEqual([]);

    await endLease(user.id);
    const again = await claim(b, 2);
    expect(again.deliveries.map((d) => d.deliveryId)).toEqual(
      first.deliveries.slice(0, 2).map((d) => d.deliveryId),
    );
    const rows2 = await rows<{ claimed_by: string }>(
      "SELECT claimed_by FROM deliveries WHERE id IN (?, ?)",
      ...again.deliveries.map((d) => d.deliveryId),
    );
    expect(rows2.map((r) => r.claimed_by)).toEqual([b.id, b.id]);
  });

  it("hands out at most one delivery per marker in one claim", async () => {
    const { user, a } = await phones();
    await claim(a);
    await endLease(user.id);
    // A second transcript adds a pending delivery next to each expired claimed one with the same marker.
    await recommend(env, await stored(user.id, OK, "2026-10-23T09:00:00.000Z"), 1);
    const claimed = await claim(a);
    expect(claimed.deliveries).toHaveLength(6);
    expect(new Set(claimed.deliveries.map((d) => d.recommendation.marker)).size).toBe(6);
    expect((await claim(a)).deliveries).toEqual([]);
  });

  it("answers 404 for an installation that is not a device of the user", async () => {
    const { a } = await phones();
    const other = await phones();
    const res = await call("/api/deliveries/claim", {
      bearer: a.bearer,
      body: { installationId: other.a.id },
    });
    await expectError(res, 404, "not_found");
    const unknown = await call("/api/deliveries/claim", {
      bearer: a.bearer,
      body: { installationId: "never-seen-1" },
    });
    await expectError(unknown, 404, "not_found");
  });

  it("stores outcomes, takes a late result only while nobody claimed since, and fails after 3 failed results", async () => {
    const { user, a, b } = await phones();
    const [d1, d2, d3, d4] = (await claim(a)).deliveries.map((d) => d.deliveryId);
    expect(
      await report(a, [
        { deliveryId: d1, outcome: "created" },
        { deliveryId: d2, outcome: "embedded" },
        { deliveryId: d1, outcome: "embed_updated" },
      ]),
    ).toBe(2);
    expect(await report(b, [{ deliveryId: d3, outcome: "created" }])).toBe(0);

    await endLease(user.id);
    // Late, nobody claimed since: counted.
    expect(await report(a, [{ deliveryId: d3, outcome: "reminder_updated" }])).toBe(1);
    // Late, and b claimed it since: ignored.
    expect((await claim(b)).deliveries.map((d) => d.deliveryId)).toContain(d4);
    expect(await report(a, [{ deliveryId: d4, outcome: "created" }])).toBe(0);

    for (let i = 1; i <= 3; i++) {
      if (i > 1) {
        await endLease(user.id);
        expect((await claim(b)).deliveries.map((d) => d.deliveryId)).toContain(d4);
      }
      expect(await report(b, [{ deliveryId: d4, outcome: "failed", errorCode: "write_failed" }])).toBe(1);
      const [row] = await rows<{ status: string; failures: number }>(
        "SELECT status, failures FROM deliveries WHERE id = ?",
        d4,
      );
      expect(row).toEqual({ status: i < 3 ? "pending" : "failed", failures: i });
    }

    const states = await rows<{
      id: string;
      status: string;
      outcome: string | null;
      error_code: string | null;
    }>("SELECT id, status, outcome, error_code FROM deliveries WHERE id IN (?, ?, ?, ?)", d1, d2, d3, d4);
    const byId = new Map(states.map((s) => [s.id, [s.status, s.outcome, s.error_code]]));
    expect([d1, d2, d3, d4].map((d) => byId.get(d ?? ""))).toEqual([
      ["applied", "created", null],
      ["applied", "embedded", null],
      ["applied", "reminder_updated", null],
      ["failed", null, "write_failed"],
    ]);
  });
});

describe("GET /api/recommendations", () => {
  it("lists newest first with the newest delivery, filters by delivered, pages, and reads one", async () => {
    const { user, cookie } = await signUp();
    const id = await stored(user.id);
    await env.DB.prepare("UPDATE patterns SET status = 'dismissed' WHERE user_id = ? AND key = ?")
      .bind(user.id, ORDER[0])
      .run();
    await recommend(env, id, 1);
    const page = async (query: string) =>
      RecommendationsPage.parse(await (await call(`/api/recommendations${query}`, { cookie })).json());

    const all = await page("");
    expect(all.items).toHaveLength(6);
    expect(all.nextCursor).toBeNull();
    expect((await page("?delivered=true")).items).toHaveLength(5);
    const undelivered = await page("?delivered=false");
    expect(undelivered.items.map((r) => [r.itemKey, r.delivery])).toEqual([[ORDER[0], null]]);

    const first = await page("?limit=4");
    expect(first.items).toHaveLength(4);
    const rest = await page(`?limit=4&cursor=${first.nextCursor}`);
    expect([...first.items, ...rest.items].map((r) => r.id)).toEqual(all.items.map((r) => r.id));
    expect(rest.nextCursor).toBeNull();

    const one = all.items.find((r) => r.itemKey === ORDER[1]);
    const res = await call(`/api/recommendations/${one?.id}`, { cookie });
    expect(RecommendationResponse.parse(await res.json()).recommendation).toEqual(one);
    expect(one?.delivery?.status).toBe("pending");

    const other = await signUp();
    await expectError(
      await call(`/api/recommendations/${one?.id}`, { cookie: other.cookie }),
      404,
      "not_found",
    );
    await expectError(
      await call("/api/recommendations?delivered=maybe", { cookie }),
      400,
      "validation_failed",
    );
  });
});

describe("the AnalyzeTranscript workflow with recommend and notify", () => {
  afterEach(() => vi.restoreAllMocks());

  async function queuedWithPhones() {
    const p = await phones();
    const id = newId("trn");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO transcripts (id, user_id, source, kind, occurred_at, participants, segments, learner_speaker_id,
         learner_word_count, status, run, created_at, updated_at)
       VALUES (?, ?, 'jamie', 'call', ?, ?, ?, ?, 300, 'received', 0, ?, ?)`,
    )
      .bind(id, p.user.id, now, participantsColumn([]), segmentsColumn(SEGMENTS), PETR, now, now)
      .run();
    return { ...p, id };
  }

  const pushes = (userId: string) =>
    rows<{ device_id: string; push_type: string; status: number | null }>(
      "SELECT device_id, push_type, status FROM push_log WHERE user_id = ? ORDER BY created_at, id",
      userId,
    );

  it("ends analyzed with recommendations, a pending delivery for each, and one push per device", async () => {
    const { user, id } = await queuedWithPhones();
    await using introspector = await introspectWorkflow(env.ANALYZE);
    await startAnalysis(env, id, "abcdefabcdef");
    const [instance] = await introspector.get();
    await instance?.waitForStatus("complete");
    const [t] = await rows<{ status: string }>("SELECT status FROM transcripts WHERE id = ?", id);
    expect(t?.status).toBe("analyzed");
    const recs = await recsOf(id);
    expect(recs).toHaveLength(6);
    const pending = await rows<{ recommendation_id: string }>(
      "SELECT recommendation_id FROM deliveries WHERE status = 'pending' AND recommendation_id IN (SELECT id FROM recommendations WHERE transcript_id = ?)",
      id,
    );
    expect(pending).toHaveLength(6);
    const log = await pushes(user.id);
    expect(log).toHaveLength(2);
    expect(new Set(log.map((p) => p.device_id)).size).toBe(2);
    expect(log.every((p) => p.push_type === "deliveries" && p.status === null)).toBe(true);
  });

  it("keeps the transcript analyzed when the push still fails after its retries", async () => {
    const { user, id } = await queuedWithPhones();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await using introspector = await introspectWorkflow(env.ANALYZE);
    await introspector.modifyAll(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "notify" }, new Error("push failed"));
    });
    await startAnalysis(env, id, "abcdefabcdef");
    const [instance] = await introspector.get();
    await instance?.waitForStatus("complete");
    const [t] = await rows<{ status: string }>("SELECT status FROM transcripts WHERE id = ?", id);
    expect(t?.status).toBe("analyzed");
    expect(await recsOf(id)).toHaveLength(6);
    expect(await pushes(user.id)).toEqual([]);
  });
});

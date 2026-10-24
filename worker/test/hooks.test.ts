import { introspectWorkflow } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { ConnectionsResponse, HookResponse } from "shared";
import meeting from "shared/fixtures/jamie/meeting-completed.json";
import meetingUnknown from "shared/fixtures/jamie/meeting-completed-unknown-speakers.json";
import jsonTranscript from "shared/fixtures/json/transcript.json";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/tokens";
import type { Env } from "../src/env";
import { call, expectError, signUp } from "./helpers";
import {
  connect,
  hookEvents,
  hookPath,
  jamieBody,
  jamieSignature,
  lastHookEvent,
  postHook,
  storedTranscript,
} from "./hooks-helpers";

async function accepted(res: Response, status = 202): Promise<string> {
  expect(res.status).toBe(status);
  const body = HookResponse.parse(await res.json());
  if (body.outcome === "ignored") throw new Error("accepted: the hook answered ignored");
  expect(body.outcome).toBe(status === 202 ? "accepted" : "duplicate");
  return body.transcriptId;
}

async function expectRefusedEvent(connectionId: string, code: string): Promise<void> {
  const event = await lastHookEvent(connectionId);
  expect(event.outcome).toBe("refused");
  expect(event.error_code).toBe(code);
}

async function countHookEvents(): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM hook_events").first<{ n: number }>();
  return row?.n ?? -1;
}

describe("POST /api/hooks/jamie/:token", () => {
  it("accepts the Jamie fixture, finds the learner by the recorder email and starts the analysis", async () => {
    // Neither the account email nor the speaker names match: only the recorder email finds Petr Ivanov.
    const { cookie, user } = await signUp({ displayName: "Someone" });
    const connection = await connect(cookie, "jamie");
    const raw = jamieBody();

    const introspector = await introspectWorkflow(env.ANALYZE);
    try {
      const transcriptId = await accepted(await postHook(hookPath(connection), raw));

      const row = await storedTranscript(transcriptId);
      expect(row).toMatchObject({
        user_id: user.id,
        connection_id: connection.id,
        source: "jamie",
        external_id: meeting.metadata.id,
        kind: "call",
        title: meeting.data.title,
        occurred_at: "2026-10-22T09:00:00.000Z",
        duration_sec: 2483,
        learner_speaker_id: "2",
        status: "queued",
        run: 1,
        error_code: null,
      });
      expect(JSON.parse(row.segments)).toHaveLength(meeting.data.transcript.length);
      expect(JSON.parse(row.segments)[0]).toEqual({
        speaker_id: "0",
        speaker_name: "Laura Bennett",
        text: meeting.data.transcript[0]?.text,
        start_sec: null,
      });
      expect(JSON.parse(row.participants)).toContainEqual({
        id: "2",
        name: "Petr Ivanov",
        email: "Petr.Ivanov@example.com",
        is_recorder: true,
      });
      expect(row.learner_word_count).toBeGreaterThan(100);

      const instance = await env.ANALYZE.get(`${transcriptId}-1`);
      expect(instance.id).toBe(`${transcriptId}-1`);
      const [created, ...others] = await introspector.get();
      expect(others).toHaveLength(0);
      // Until step B08 the workflow ends at once with a NonRetryableError.
      await created?.waitForStatus("errored");
    } finally {
      await introspector.dispose();
    }

    const event = await lastHookEvent(connection.id);
    expect(event).toMatchObject({
      outcome: "accepted",
      error_code: null,
      size_bytes: new TextEncoder().encode(raw).byteLength,
      body: raw,
      body_sha256: await sha256Hex(raw),
      content_type: "application/json",
    });
    expect(event.request_id).toMatch(/^[0-9a-f]{12}$/);

    const list = ConnectionsResponse.parse(await (await call("/api/connections", { cookie })).json());
    expect(list.connections[0]).toMatchObject({ lastEventOutcome: "accepted", lastEventError: null });
    expect(list.connections[0]?.lastEventAt).not.toBeNull();
  });

  it("answers the same delivery again as a duplicate with the same transcript", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const first = await accepted(await postHook(hookPath(connection), jamieBody()));
    const second = await accepted(await postHook(hookPath(connection), jamieBody()), 200);
    expect(second).toBe(first);

    const events = await hookEvents(connection.id);
    expect(events.map((e) => [e.outcome, e.transcript_id])).toEqual([
      ["accepted", first],
      ["duplicate", first],
    ]);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM transcripts WHERE connection_id = ?")
      .bind(connection.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("checks the signature when the connection has a signing secret", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const secret = "whsec_0123456789";
    const patch = await call(`/api/connections/${connection.id}`, {
      method: "PATCH",
      cookie,
      body: { signingSecret: secret },
    });
    expect(patch.status).toBe(200);
    const path = hookPath(connection);
    const raw = jamieBody();
    const now = Math.floor(Date.now() / 1000);

    const refusedWith = async (headers: Record<string, string>) => {
      await expectError(await postHook(path, raw, headers), 401, "signature_invalid");
      await expectRefusedEvent(connection.id, "signature_invalid");
    };
    await refusedWith({ "x-jamie-signature": await jamieSignature(raw, "wrong secret", now) });
    await refusedWith({});
    await refusedWith({ "x-jamie-signature": await jamieSignature(raw, secret, now - 2 * 3600 - 10) });
    await refusedWith({ "x-jamie-signature": await jamieSignature(`${raw} `, secret, now) });

    const valid = { "x-jamie-signature": await jamieSignature(raw, secret, now) };
    await accepted(await postHook(path, raw, valid));
  });

  it("refuses a paused connection with 403 hook_paused", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    await call(`/api/connections/${connection.id}`, { method: "PATCH", cookie, body: { status: "paused" } });
    await expectError(await postHook(hookPath(connection), jamieBody()), 403, "hook_paused");
    await expectRefusedEvent(connection.id, "hook_paused");
    expect((await lastHookEvent(connection.id)).body).toBe(jamieBody());
  });

  it("answers 404 hook_not_found and stores nothing for an unknown token or a token of another source", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const before = await countHookEvents();
    const token = hookPath(connection).split("/").at(-1);
    await expectError(await postHook("/api/hooks/jamie/unknown-token", jamieBody()), 404, "hook_not_found");
    await expectError(await postHook(`/api/hooks/json/${token}`, jamieBody()), 404, "hook_not_found");
    await expectError(await postHook(`/api/hooks/paste/${token}`, jamieBody()), 404, "hook_not_found");
    expect(await countHookEvents()).toBe(before);
  });

  it("refuses a body over 1,000,000 bytes with 413 and keeps an empty body", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const raw = `{"padding":"${"x".repeat(1_000_000)}"}`;
    await expectError(await postHook(hookPath(connection), raw), 413, "payload_too_large");
    const event = await lastHookEvent(connection.id);
    expect(event).toMatchObject({ outcome: "refused", error_code: "payload_too_large", body: "" });
    expect(event.size_bytes).toBeGreaterThan(1_000_000);
  });

  it("refuses another content type with 415", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const res = await postHook(hookPath(connection), jamieBody(), { "Content-Type": "text/plain" });
    await expectError(res, 415, "unsupported_media_type");
    await expectRefusedEvent(connection.id, "unsupported_media_type");
    const charset = { "Content-Type": "Application/JSON; charset=utf-8" };
    await accepted(await postHook(hookPath(connection), jamieBody(), charset));
  });

  it("refuses broken JSON with 400 and a body without a transcript with 422", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    await expectError(await postHook(hookPath(connection), "{ not json"), 400, "bad_json");
    await expectRefusedEvent(connection.id, "bad_json");

    const { transcript: _, ...data } = meeting.data;
    const raw = JSON.stringify({ ...meeting, data });
    await expectError(await postHook(hookPath(connection), raw), 422, "payload_invalid");
    await expectRefusedEvent(connection.id, "payload_invalid");
    expect((await lastHookEvent(connection.id)).body).toBe(raw);
  });

  it("answers an event other than meeting.completed with 200 ignored", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const res = await postHook(hookPath(connection), jamieBody(), { "jamie-event": "meeting.shared" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "ignored" });
    expect(await lastHookEvent(connection.id)).toMatchObject({ outcome: "ignored", error_code: null });
  });

  it("starts the analysis without a learner when Jamie does not know the voices", async () => {
    const { cookie } = await signUp({ displayName: "Petr" });
    await call("/api/me", { method: "PATCH", cookie, body: { speakerNames: ["Petr", "Speaker 2"] } });
    const connection = await connect(cookie, "jamie");
    const transcriptId = await accepted(await postHook(hookPath(connection), JSON.stringify(meetingUnknown)));
    // A saved "Speaker 2" never matches a placeholder name.
    expect(await storedTranscript(transcriptId)).toMatchObject({
      status: "queued",
      learner_speaker_id: null,
      run: 1,
    });
  });

  it("leaves the transcript failed with internal when the workflow cannot start, and still answers 202", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const failing = {
      create: async () => {
        throw new Error("workflow create failed in a test");
      },
    } as unknown as Env["ANALYZE"];
    const res = await call(hookPath(connection), {
      method: "POST",
      rawBody: jamieBody(),
      origin: null,
      headers: { "Content-Type": "application/json" },
      bindings: { ANALYZE: failing },
    });
    const transcriptId = await accepted(res);
    expect(await storedTranscript(transcriptId)).toMatchObject({
      status: "failed",
      error_code: "internal",
      run: 1,
    });
    expect((await lastHookEvent(connection.id)).outcome).toBe("accepted");
  });

  it("limits a token to 60 requests per minute", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const path = hookPath(connection);
    for (let i = 0; i < 60; i++) {
      expect((await postHook(path, "{}", { "Content-Type": "text/plain" })).status).toBe(415);
    }
    const res = await postHook(path, "{}", { "Content-Type": "text/plain" });
    await expectError(res, 429, "rate_limited");
    expect(res.headers.get("Retry-After")).toBe("60");
    await expectRefusedEvent(connection.id, "rate_limited");
  });
});

describe("POST /api/hooks/json/:token", () => {
  it("accepts the json fixture and takes learnerSpeaker as the learner", async () => {
    const { cookie } = await signUp({ displayName: "Laura" });
    const connection = await connect(cookie, "json");
    const transcriptId = await accepted(await postHook(hookPath(connection), JSON.stringify(jsonTranscript)));
    expect(await storedTranscript(transcriptId)).toMatchObject({
      source: "json",
      external_id: jsonTranscript.id,
      kind: "chat",
      occurred_at: jsonTranscript.occurredAt,
      learner_speaker_id: "Petr Ivanov",
      status: "queued",
    });
  });

  it("starts the analysis without a learner when two speakers match a speaker name", async () => {
    const { cookie } = await signUp({ displayName: "Petr" });
    const connection = await connect(cookie, "json");
    const body = {
      segments: [
        { speaker: "Petr Ivanov", text: "Hello, I am Petr." },
        { speaker: "Petr Smirnov", text: "Hello, I am Petr too." },
      ],
    };
    const transcriptId = await accepted(await postHook(hookPath(connection), JSON.stringify(body)));
    expect(await storedTranscript(transcriptId)).toMatchObject({
      status: "queued",
      learner_speaker_id: null,
    });
  });

  it("refuses segments over 1,500,000 bytes as JSON with 422", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "json");
    // Stored segments repeat the speaker name as id and name, so a body under 1,000,000 bytes grows past the limit.
    const speaker = "S".repeat(40);
    const raw = JSON.stringify({ segments: Array.from({ length: 14_000 }, () => ({ speaker, text: "a" })) });
    expect(raw.length).toBeLessThan(1_000_000);
    await expectError(await postHook(hookPath(connection), raw), 422, "payload_invalid");
    await expectRefusedEvent(connection.id, "payload_invalid");
  });
});

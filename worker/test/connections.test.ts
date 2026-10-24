import { env } from "cloudflare:workers";
import { ConnectionResponse, ConnectionsResponse, HookEventsResponse, SourcesResponse } from "shared";
import { describe, expect, it } from "vitest";
import { call, expectError, signUp } from "./helpers";
import { connect, hookPath, jamieBody, postHook, storedTranscript } from "./hooks-helpers";

describe("GET /api/sources", () => {
  it("lists jamie, paste and json with their setup steps", async () => {
    const { cookie } = await signUp();
    const res = await call("/api/sources", { cookie });
    expect(res.status).toBe(200);
    const { sources } = SourcesResponse.parse(await res.json());
    expect(sources.map((s) => [s.id, s.name, s.kind, s.webhook])).toEqual([
      ["jamie", "Jamie", "call", true],
      ["paste", "Paste", "text", false],
      ["json", "Webhook JSON", "call", true],
    ]);
    expect(sources.every((s) => s.setupSteps.length > 0)).toBe(true);
  });

  it("needs a session", async () => {
    await expectError(await call("/api/sources"), 401, "unauthorized");
  });
});

describe("/api/connections", () => {
  it("creates a connection with a secret webhook URL", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    expect(connection).toMatchObject({
      source: "jamie",
      label: "Jamie",
      status: "active",
      hasSigningSecret: false,
      lastEventAt: null,
      lastEventOutcome: null,
      lastEventError: null,
    });
    expect(connection.id).toMatch(/^con_/);
    expect(connection.webhookUrl).toMatch(
      new RegExp(`^${env.APP_ORIGIN}/api/hooks/jamie/[A-Za-z0-9_-]{43}$`),
    );

    const labelled = await connect(cookie, "json", "Zapier");
    expect(labelled).toMatchObject({ source: "json", label: "Zapier" });
    expect(labelled.webhookUrl).not.toBe(connection.webhookUrl);

    const list = ConnectionsResponse.parse(await (await call("/api/connections", { cookie })).json());
    expect(list.connections.map((c) => c.id)).toEqual([connection.id, labelled.id]);
  });

  it("refuses a source without webhooks", async () => {
    const { cookie } = await signUp();
    const res = await call("/api/connections", { cookie, body: { source: "paste" } });
    await expectError(res, 400, "validation_failed");
  });

  it("renames, pauses, resumes and sets and removes the signing secret", async () => {
    const { cookie } = await signUp();
    const { id } = await connect(cookie, "jamie");
    const patch = async (body: unknown) => {
      const res = await call(`/api/connections/${id}`, { method: "PATCH", cookie, body });
      expect(res.status).toBe(200);
      return ConnectionResponse.parse(await res.json()).connection;
    };
    expect(await patch({ label: "Work calls" })).toMatchObject({ label: "Work calls", status: "active" });
    expect(await patch({ status: "paused" })).toMatchObject({ label: "Work calls", status: "paused" });
    expect(await patch({ status: "active", signingSecret: "s3cret" })).toMatchObject({
      status: "active",
      hasSigningSecret: true,
    });
    const stored = await env.DB.prepare("SELECT signing_secret FROM connections WHERE id = ?")
      .bind(id)
      .first<{ signing_secret: string | null }>();
    expect(stored?.signing_secret).toBe("s3cret");
    expect(await patch({ signingSecret: null })).toMatchObject({ hasSigningSecret: false });
    expect(await patch({})).toMatchObject({ label: "Work calls" });
  });

  it("refuses a signing secret for the json source, which has no signature check", async () => {
    const { cookie } = await signUp();
    const { id } = await connect(cookie, "json");
    const res = await call(`/api/connections/${id}`, {
      method: "PATCH",
      cookie,
      body: { signingSecret: "x" },
    });
    const body = await expectError(res, 400, "validation_failed");
    expect(body.issues).toEqual([{ path: "signingSecret", code: "custom" }]);
  });

  it("rotates the webhook URL: the old one answers 404 hook_not_found", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const res = await call(`/api/connections/${connection.id}/rotate`, { method: "POST", cookie });
    expect(res.status).toBe(200);
    const rotated = ConnectionResponse.parse(await res.json()).connection;
    expect(rotated.webhookUrl).not.toBe(connection.webhookUrl);

    await expectError(await postHook(hookPath(connection), jamieBody()), 404, "hook_not_found");
    expect((await postHook(hookPath(rotated), jamieBody())).status).toBe(202);
  });

  it("deletes a connection: its transcripts stay with connectionId null, its events go", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const hook = await postHook(hookPath(connection), jamieBody());
    const { transcriptId } = (await hook.json()) as { transcriptId: string };

    const res = await call(`/api/connections/${connection.id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(204);
    expect((await storedTranscript(transcriptId)).connection_id).toBeNull();
    const events = await env.DB.prepare("SELECT count(*) AS n FROM hook_events WHERE connection_id = ?")
      .bind(connection.id)
      .first<{ n: number }>();
    expect(events?.n).toBe(0);
    await expectError(await postHook(hookPath(connection), jamieBody()), 404, "hook_not_found");
    const again = await call(`/api/connections/${connection.id}`, { method: "DELETE", cookie });
    await expectError(again, 404, "not_found");
  });

  it("lists the newest 20 events, newest first", async () => {
    const { cookie } = await signUp();
    const connection = await connect(cookie, "jamie");
    const path = hookPath(connection);
    const accepted = (await (await postHook(path, jamieBody())).json()) as { transcriptId: string };
    for (let i = 0; i < 20; i++) await postHook(path, "{", { "Content-Type": "text/plain" });

    const res = await call(`/api/connections/${connection.id}/events`, { cookie });
    expect(res.status).toBe(200);
    const { events } = HookEventsResponse.parse(await res.json());
    expect(events).toHaveLength(20);
    expect(events.every((e) => e.outcome === "refused" && e.errorCode === "unsupported_media_type")).toBe(
      true,
    );
    expect(events.map((e) => e.receivedAt)).toEqual(
      events
        .map((e) => e.receivedAt)
        .sort()
        .reverse(),
    );
    expect(events.some((e) => e.transcriptId === accepted.transcriptId)).toBe(false);
    expect(events[0]?.sizeBytes).toBe(1);
  });

  it("answers 404 for a connection of another user", async () => {
    const owner = await signUp();
    const other = await signUp();
    const { id } = await connect(owner.cookie, "jamie");
    const cookie = other.cookie;
    await expectError(
      await call(`/api/connections/${id}`, { method: "PATCH", cookie, body: { label: "x" } }),
      404,
      "not_found",
    );
    await expectError(
      await call(`/api/connections/${id}/rotate`, { method: "POST", cookie }),
      404,
      "not_found",
    );
    await expectError(await call(`/api/connections/${id}/events`, { cookie }), 404, "not_found");
    await expectError(await call(`/api/connections/${id}`, { method: "DELETE", cookie }), 404, "not_found");
    const list = ConnectionsResponse.parse(await (await call("/api/connections", { cookie })).json());
    expect(list.connections).toEqual([]);
  });
});

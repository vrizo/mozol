import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { newId } from "../src/ids";

const T0 = "2026-10-24T12:00:00.000Z";
const TABLES = [
  "analyses",
  "app_codes",
  "connections",
  "deliveries",
  "devices",
  "findings",
  "hook_events",
  "keywords",
  "patterns",
  "push_log",
  "recommendations",
  "sessions",
  "transcripts",
  "users",
  "word_suggestions",
  "words",
  "worker_state",
];
const USER_TABLES = TABLES.filter((t) => t !== "users" && t !== "worker_state");

type Row = Record<string, string | number | null>;

function insert(table: string, row: Row): D1PreparedStatement {
  const columns = Object.keys(row);
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  return env.DB.prepare(sql).bind(...Object.values(row));
}

async function count(table: string, where: string, ...binds: (string | number)[]): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  if (!row) throw new Error(`count: no row from ${table}`);
  return row.n;
}

async function value(table: string, column: string, id: string): Promise<unknown> {
  const row = await env.DB.prepare(`SELECT ${column} AS v FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ v: unknown }>();
  if (!row) throw new Error(`value: no ${table} row ${id}`);
  return row.v;
}

const rows = {
  user: (id: string): Row => ({
    id,
    email: `${id.toLowerCase()}@example.com`,
    password_hash: "pbkdf2-sha256$100000$c2FsdA==$aGFzaA==",
    display_name: "Test",
    native_language: "ru",
    speaker_names: '["Petr"]',
    reminder_settings: '{"embed_in_my_reminders":true}',
    created_at: T0,
    updated_at: T0,
  }),
  connection: (id: string, userId: string): Row => ({
    id,
    user_id: userId,
    source: "json",
    label: "Test",
    hook_token: `tok_${id}`,
    status: "active",
    settings: "{}",
    created_at: T0,
    updated_at: T0,
  }),
  transcript: (id: string, userId: string, connectionId: string | null, externalId: string | null): Row => ({
    id,
    user_id: userId,
    connection_id: connectionId,
    source: connectionId ? "json" : "paste",
    external_id: externalId,
    kind: "call",
    occurred_at: T0,
    participants: "[]",
    segments: "[]",
    status: "received",
    created_at: T0,
    updated_at: T0,
  }),
  analysis: (id: string, userId: string, transcriptId: string): Row => ({
    id,
    transcript_id: transcriptId,
    user_id: userId,
    run: 1,
    prompt_version: "v1",
    model: "test-model",
    status: "ok",
    language: "en",
    result: "{}",
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    duration_ms: 1,
    unmatched_quotes: 0,
    created_at: T0,
  }),
  pattern: (id: string, userId: string, key: string): Row => ({
    id,
    user_id: userId,
    language: "en",
    key,
    category: "grammar",
    title: "Title",
    match_terms: "[]",
    occurrences_total: 1,
    transcripts_count: 1,
    sources: '["json"]',
    first_seen_at: T0,
    last_seen_at: T0,
    status: "active",
  }),
  word: (id: string, userId: string, wordKey: string): Row => ({
    id,
    user_id: userId,
    language: "en",
    word_key: wordKey,
    term: wordKey,
    type: "word",
    translation: "t",
    meaning: "m",
    example: "e",
    example_translation: "et",
    times_suggested: 1,
    first_seen_at: T0,
    last_seen_at: T0,
    status: "new",
  }),
  recommendation: (id: string, userId: string, transcriptId: string, itemKey: string): Row => ({
    id,
    user_id: userId,
    transcript_id: transcriptId,
    language: "en",
    kind: "mistake",
    item_key: itemKey,
    marker: "0a1b2c3d",
    rank: 1,
    title: "t",
    notes: "n",
    embed_line: "l",
    match_terms: "[]",
    content: "{}",
    created_at: T0,
  }),
  delivery: (id: string, userId: string, recommendationId: string): Row => ({
    id,
    user_id: userId,
    recommendation_id: recommendationId,
    marker: "0a1b2c3d",
    status: "pending",
    created_at: T0,
    updated_at: T0,
  }),
  device: (id: string, userId: string): Row => ({
    id,
    user_id: userId,
    installation_id: `inst_${id}`,
    platform: "ios",
    bundle_id: "net.vrizo.mozol",
    apns_token: "ab".repeat(32),
    apns_environment: "sandbox",
    reminders_access: "full",
    last_seen_at: T0,
    created_at: T0,
    updated_at: T0,
  }),
  pushLog: (id: string, userId: string, deviceId: string): Row => ({
    id,
    user_id: userId,
    device_id: deviceId,
    push_type: "deliveries",
    created_at: T0,
  }),
};

// One user with a row in every table that holds user data.
async function seedUser() {
  const ids = {
    user: newId("usr"),
    session: newId("ses"),
    appCode: `code_${newId("ses")}`,
    device: newId("dev"),
    push: newId("psh"),
    connection: newId("con"),
    event: newId("evt"),
    transcript: newId("trn"),
    analysis: newId("ana"),
    pattern: newId("pat"),
    word: newId("wrd"),
    finding: newId("fnd"),
    suggestion: newId("wsg"),
    recommendation: newId("rec"),
    delivery: newId("dlv"),
  };
  const u = ids.user;
  await env.DB.batch([
    insert("users", rows.user(u)),
    insert("sessions", {
      id: ids.session,
      user_id: u,
      token_hash: `hash_${ids.session}`,
      kind: "web",
      created_at: T0,
      last_used_at: T0,
      expires_at: T0,
    }),
    insert("app_codes", { code_hash: ids.appCode, user_id: u, created_at: T0, expires_at: T0 }),
    insert("devices", rows.device(ids.device, u)),
    insert("push_log", rows.pushLog(ids.push, u, ids.device)),
    insert("connections", rows.connection(ids.connection, u)),
    insert("transcripts", rows.transcript(ids.transcript, u, ids.connection, "ext-1")),
    insert("hook_events", {
      id: ids.event,
      connection_id: ids.connection,
      user_id: u,
      received_at: T0,
      request_id: "0123456789ab",
      content_type: "application/json",
      size_bytes: 2,
      body: "{}",
      body_sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      outcome: "accepted",
      transcript_id: ids.transcript,
    }),
    insert("analyses", rows.analysis(ids.analysis, u, ids.transcript)),
    insert("patterns", rows.pattern(ids.pattern, u, "grammar.tense.past_simple")),
    insert("words", rows.word(ids.word, u, "nevertheless")),
    insert("findings", {
      id: ids.finding,
      transcript_id: ids.transcript,
      analysis_id: ids.analysis,
      user_id: u,
      pattern_id: ids.pattern,
      language: "en",
      category: "grammar",
      severity: "medium",
      occurrences: 2,
      title: "t",
      examples: "[]",
      explanation: "e",
      match_terms: "[]",
      created_at: T0,
    }),
    insert("word_suggestions", {
      id: ids.suggestion,
      transcript_id: ids.transcript,
      analysis_id: ids.analysis,
      user_id: u,
      word_id: ids.word,
      language: "en",
      reason: "better_choice",
      example: "e",
      example_translation: "et",
      match_terms: "[]",
      created_at: T0,
    }),
    insert("keywords", {
      user_id: u,
      transcript_id: ids.transcript,
      item_key: "word:nevertheless",
      language: "en",
      term: "nevertheless",
      term_lang: "en",
      mode: "word",
    }),
    insert(
      "recommendations",
      rows.recommendation(ids.recommendation, u, ids.transcript, "word:nevertheless"),
    ),
    insert("deliveries", rows.delivery(ids.delivery, u, ids.recommendation)),
  ]);
  return ids;
}

describe("0001_init", () => {
  it("creates every table of the data model", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(TABLES);
  });

  it("enforces foreign keys", async () => {
    const orphan = { ...rows.connection(newId("con"), "usr_missing") };
    await expect(insert("connections", orphan).run()).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe("deleting rows", () => {
  it("deleting a user removes every row of that user and nothing of another user", async () => {
    const gone = await seedUser();
    const kept = await seedUser();
    for (const table of USER_TABLES) expect(await count(table, "user_id = ?", gone.user), table).toBe(1);

    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(gone.user).run();

    for (const table of USER_TABLES) {
      expect(await count(table, "user_id = ?", gone.user), table).toBe(0);
      expect(await count(table, "user_id = ?", kept.user), table).toBe(1);
    }
  });

  it("deleting a connection keeps its transcripts with connection_id null and removes its hook events", async () => {
    const ids = await seedUser();

    await env.DB.prepare("DELETE FROM connections WHERE id = ?").bind(ids.connection).run();

    expect(await value("transcripts", "connection_id", ids.transcript)).toBeNull();
    expect(await count("hook_events", "connection_id = ?", ids.connection)).toBe(0);
    expect(await count("hook_events", "id = ?", ids.event)).toBe(0);
  });

  it("deleting a transcript removes its results and keeps its recommendations and deliveries", async () => {
    const ids = await seedUser();

    await env.DB.prepare("DELETE FROM transcripts WHERE id = ?").bind(ids.transcript).run();

    for (const table of ["analyses", "findings", "word_suggestions", "keywords"]) {
      expect(await count(table, "transcript_id = ?", ids.transcript), table).toBe(0);
    }
    expect(await value("recommendations", "transcript_id", ids.recommendation)).toBeNull();
    expect(await value("hook_events", "transcript_id", ids.event)).toBeNull();
    expect(await count("deliveries", "id = ?", ids.delivery)).toBe(1);
    expect(await count("patterns", "id = ?", ids.pattern)).toBe(1);
    expect(await count("words", "id = ?", ids.word)).toBe(1);
  });
});

describe("unique keys", () => {
  it("users.email", async () => {
    const ids = await seedUser();
    const twin = { ...rows.user(newId("usr")), email: `${ids.user.toLowerCase()}@example.com` };
    await expect(insert("users", twin).run()).rejects.toThrow(/UNIQUE constraint failed: users\.email/);
  });

  it("connections.hook_token", async () => {
    const ids = await seedUser();
    const twin = { ...rows.connection(newId("con"), ids.user), hook_token: `tok_${ids.connection}` };
    await expect(insert("connections", twin).run()).rejects.toThrow(
      /UNIQUE constraint failed: connections\.hook_token/,
    );
  });

  it("transcripts (connection_id, external_id), and many transcripts without either", async () => {
    const ids = await seedUser();
    const twin = rows.transcript(newId("trn"), ids.user, ids.connection, "ext-1");
    await expect(insert("transcripts", twin).run()).rejects.toThrow(
      /UNIQUE constraint failed: transcripts\.connection_id, transcripts\.external_id/,
    );
    await env.DB.batch([
      insert("transcripts", rows.transcript(newId("trn"), ids.user, null, null)),
      insert("transcripts", rows.transcript(newId("trn"), ids.user, null, null)),
    ]);
    expect(await count("transcripts", "user_id = ? AND connection_id IS NULL", ids.user)).toBe(2);
  });

  it("analyses.transcript_id", async () => {
    const ids = await seedUser();
    const twin = rows.analysis(newId("ana"), ids.user, ids.transcript);
    await expect(insert("analyses", twin).run()).rejects.toThrow(
      /UNIQUE constraint failed: analyses\.transcript_id/,
    );
  });

  it("patterns (user_id, language, key)", async () => {
    const ids = await seedUser();
    const twin = rows.pattern(newId("pat"), ids.user, "grammar.tense.past_simple");
    await expect(insert("patterns", twin).run()).rejects.toThrow(
      /UNIQUE constraint failed: patterns\.user_id, patterns\.language, patterns\.key/,
    );
  });

  it("words (user_id, language, word_key)", async () => {
    const ids = await seedUser();
    const twin = rows.word(newId("wrd"), ids.user, "nevertheless");
    await expect(insert("words", twin).run()).rejects.toThrow(
      /UNIQUE constraint failed: words\.user_id, words\.language, words\.word_key/,
    );
  });

  it("recommendations (transcript_id, item_key)", async () => {
    const ids = await seedUser();
    const twin = rows.recommendation(newId("rec"), ids.user, ids.transcript, "word:nevertheless");
    await expect(insert("recommendations", twin).run()).rejects.toThrow(
      /UNIQUE constraint failed: recommendations\.transcript_id, recommendations\.item_key/,
    );
  });
});

describe("checks", () => {
  it.each([
    ["transcripts", "status", "done", "transcript"],
    ["deliveries", "status", "sent", "delivery"],
    ["devices", "reminders_access", "allowed", "device"],
    ["push_log", "push_type", "alert", "push"],
    ["recommendations", "kind", "lesson", "recommendation"],
  ] as const)("%s.%s refuses %s", async (table, column, wrong, row) => {
    const ids = await seedUser();
    await expect(
      env.DB.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).bind(wrong, ids[row]).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it.each([
    ["users", "reminder_settings", "user"],
    ["transcripts", "segments", "transcript"],
    ["recommendations", "content", "recommendation"],
  ] as const)("%s.%s refuses invalid JSON", async (table, column, row) => {
    const ids = await seedUser();
    await expect(
      env.DB.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).bind('{"open": ', ids[row]).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("devices refuse an APNs token without an environment", async () => {
    const ids = await seedUser();
    await expect(
      env.DB.prepare("UPDATE devices SET apns_environment = NULL WHERE id = ?").bind(ids.device).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("users refuse an email with capital letters", async () => {
    const row = { ...rows.user(newId("usr")), email: "Petr@Example.com" };
    await expect(insert("users", row).run()).rejects.toThrow(/CHECK constraint failed/);
  });
});

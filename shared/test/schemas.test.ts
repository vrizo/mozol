// Schema rules: what the contract refuses, and that AnalysisResult converts to JSON Schema for structured output.
import { describe, expect, test } from "vitest";
import { z } from "zod";
import resultOk from "../fixtures/analysis/result-ok.json";
import claimResponse from "../fixtures/deliveries/claim-response.json";
import {
  AnalysisResult,
  ClaimBody,
  ClaimResponse,
  CreateConnectionBody,
  ErrorBody,
  ModelAnalysisResult,
  PageQuery,
  PatchMeBody,
  PutDeviceBody,
  RecommendationsQuery,
  ReminderSettings,
  SignUpBody,
  User,
} from "../src";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function analysis(change: (result: z.input<typeof AnalysisResult>) => void) {
  const result = clone(resultOk) as z.input<typeof AnalysisResult>;
  change(result);
  return result;
}

function issuesOf(schema: z.ZodType, value: unknown): string[] {
  const parsed = schema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`);
}

const user = {
  id: "usr_01JB8Z6Q4M2V7N3K5D9X1C0F8T",
  email: "petr.ivanov@example.com",
  displayName: "Petr Ivanov",
  nativeLanguage: "ru",
  speakerNames: ["Petr Ivanov"],
  reminderSettings: { embedInMyReminders: true },
  createdAt: "2026-10-20T08:00:00.000Z",
};

const device = {
  platform: "ios",
  bundleId: "net.vrizo.mozol",
  appVersion: "1.0 (12)",
  osVersion: "26.1",
  apnsToken: "a".repeat(64),
  apnsEnvironment: "sandbox",
  remindersAccess: "full",
};

describe("analysis result rules", () => {
  test("the fixture is valid", () => {
    expect(issuesOf(AnalysisResult, resultOk)).toEqual([]);
  });

  test("refuses a bad pattern key", () => {
    const bad = analysis((r) => {
      r.findings[0] = { ...r.findings[0], patternKey: "register.swearing" } as never;
    });
    expect(issuesOf(AnalysisResult, bad)).toContain("findings.0.patternKey: invalid_format");
    const upper = analysis((r) => {
      r.findings[0] = { ...r.findings[0], patternKey: "register.Swearing.shit" } as never;
    });
    expect(issuesOf(AnalysisResult, upper)).toContain("findings.0.patternKey: invalid_format");
  });

  test("refuses a category that differs from the first part of the key", () => {
    const bad = analysis((r) => {
      r.findings[0] = { ...r.findings[0], category: "vocabulary" } as never;
    });
    expect(issuesOf(AnalysisResult, bad)).toEqual(["findings.0.category: custom"]);
  });

  test("refuses two findings with one pattern key", () => {
    const bad = analysis((r) => {
      r.findings[2] = clone(r.findings[0]) as never;
    });
    expect(issuesOf(AnalysisResult, bad)).toEqual(["findings.2.patternKey: custom"]);
  });

  test("refuses two words with one word key", () => {
    const bad = analysis((r) => {
      r.words[2] = { ...clone(r.words[0]), term: "Make a  decision!" } as never;
    });
    expect(issuesOf(AnalysisResult, bad)).toEqual(["words.2.term: custom"]);
  });

  test("refuses a prefix term shorter than 4 characters", () => {
    const bad = analysis((r) => {
      r.words[0]?.matchTerms.push({ text: "реш", lang: "ru", mode: "prefix" });
    });
    expect(issuesOf(AnalysisResult, bad)).toEqual(["words.0.matchTerms.4.text: custom"]);
  });

  test("refuses a word term with a space", () => {
    const bad = analysis((r) => {
      r.words[0]?.matchTerms.push({ text: "make decision", lang: "en", mode: "word" });
    });
    expect(issuesOf(AnalysisResult, bad)).toEqual(["words.0.matchTerms.4.text: custom"]);
  });

  test("refuses a phrase term with one word", () => {
    const bad = analysis((r) => {
      r.words[0]?.matchTerms.push({ text: "decision", lang: "en", mode: "phrase" });
    });
    expect(issuesOf(AnalysisResult, bad)).toEqual(["words.0.matchTerms.4.text: custom"]);
  });

  test("refuses 4 examples in one finding, and none", () => {
    const four = analysis((r) => {
      const f = r.findings[0];
      if (f) f.examples = [...f.examples, { quote: "when user wants", correction: "when the user wants" }];
    });
    expect(issuesOf(AnalysisResult, four)).toEqual(["findings.0.examples: too_big"]);
    const none = analysis((r) => {
      const f = r.findings[0];
      if (f) f.examples = [];
    });
    expect(issuesOf(AnalysisResult, none)).toEqual(["findings.0.examples: too_small"]);
  });

  test("refuses a title over 60 characters, 9 match terms, and a finding or a word without match terms", () => {
    const bad = analysis((r) => {
      const f = r.findings[2];
      if (f) {
        f.title = "x".repeat(61);
        f.matchTerms = Array.from({ length: 9 }, (_, i) => ({ text: `term${i}`, lang: "en", mode: "word" }));
      }
      const g = r.findings[1];
      if (g) g.matchTerms = [];
      const w = r.words[1];
      if (w) w.matchTerms = [];
    });
    expect(issuesOf(AnalysisResult, bad)).toEqual([
      "findings.1.matchTerms: too_small",
      "findings.2.title: too_big",
      "findings.2.matchTerms: too_big",
      "words.1.matchTerms: too_small",
    ]);
  });

  test("refuses more than 3 findings and more than 3 words", () => {
    const many = analysis((r) => {
      r.findings.push({ ...clone(r.findings[0]), patternKey: "grammar.articles.extra" } as never);
      r.words.push({ ...clone(r.words[0]), term: "decide" } as never);
    });
    expect(issuesOf(AnalysisResult, many)).toEqual(["findings: too_big", "words: too_big"]);
  });

  test("a status other than ok has empty lists; language is null only with too_little_speech", () => {
    const bad = analysis((r) => {
      r.status = "native_language";
      r.language = null;
    });
    expect(issuesOf(AnalysisResult, bad)).toEqual(["language: custom", "findings: custom", "words: custom"]);
    const tooLittle = { status: "too_little_speech", language: null, findings: [], words: [] };
    expect(issuesOf(AnalysisResult, tooLittle)).toEqual([]);
  });

  test("the model cannot answer native_language; a stored native_language result still parses", () => {
    const native = { status: "native_language", language: "en", findings: [], words: [] };
    expect(issuesOf(ModelAnalysisResult, native)).toEqual(["status: invalid_value"]);
    expect(issuesOf(AnalysisResult, native)).toEqual([]);
  });

  test("refuses an unknown key in the result", () => {
    const bad = analysis((r) => {
      Object.assign(r, { confidence: 0.9 });
    });
    expect(issuesOf(AnalysisResult, bad)).toEqual([": unrecognized_keys"]);
  });
});

describe("structured output", () => {
  // Every schema node needs a type, anyOf, allOf or $ref: the SDK's JSON Schema transform requires it.
  function untyped(node: unknown, path: string): string[] {
    if (typeof node !== "object" || node === null) return [];
    const schema = node as Record<string, unknown>;
    const own = ["type", "anyOf", "oneOf", "allOf", "$ref"].some((k) => k in schema) ? [] : [path];
    const children: [string, unknown][] = [
      ...Object.entries((schema.properties as object) ?? {}).map(([k, v]): [string, unknown] => [
        `${path}.${k}`,
        v,
      ]),
      ...Object.entries((schema.$defs as object) ?? {}).map(([k, v]): [string, unknown] => [`$defs.${k}`, v]),
      ...((schema.anyOf as unknown[]) ?? []).map((v, i): [string, unknown] => [`${path}|${i}`, v]),
      ...(schema.items ? [[`${path}[]`, schema.items] as [string, unknown]] : []),
    ];
    return [...own, ...children.flatMap(([p, v]) => untyped(v, p))];
  }

  test("AnalysisResult with its refinements converts to JSON Schema with a type on every node", () => {
    const json = z.toJSONSchema(AnalysisResult, { reused: "ref" });
    expect(untyped(json, "")).toEqual([]);
    expect(json.additionalProperties).toBe(false);
  });
});

describe("request and response rules", () => {
  test("reminder settings hold only embedInMyReminders", () => {
    expect(issuesOf(ReminderSettings, { embedInMyReminders: false })).toEqual([]);
    expect(issuesOf(ReminderSettings, { embedInMyReminders: true, intensity: "normal" })).toEqual([
      ": unrecognized_keys",
    ]);
  });

  test("refuses an apnsToken with a null apnsEnvironment, and the reverse", () => {
    expect(issuesOf(PutDeviceBody, device)).toEqual([]);
    expect(issuesOf(PutDeviceBody, { ...device, apnsEnvironment: null })).toEqual([
      "apnsEnvironment: custom",
    ]);
    expect(issuesOf(PutDeviceBody, { ...device, apnsToken: null })).toEqual(["apnsEnvironment: custom"]);
    expect(issuesOf(PutDeviceBody, { ...device, apnsToken: null, apnsEnvironment: null })).toEqual([]);
  });

  test("refuses an APNs token that is not lowercase hex", () => {
    expect(issuesOf(PutDeviceBody, { ...device, apnsToken: "A".repeat(64) })).toEqual([
      "apnsToken: invalid_format",
    ]);
  });

  test("refuses an unknown key in a request body", () => {
    expect(issuesOf(CreateConnectionBody, { source: "jamie", label: "Work", color: "red" })).toEqual([
      ": unrecognized_keys",
    ]);
    expect(issuesOf(PatchMeBody, { displayName: "Petr", admin: true })).toEqual([": unrecognized_keys"]);
    expect(issuesOf(PutDeviceBody, { ...device, model: "iPhone17,1" })).toEqual([": unrecognized_keys"]);
  });

  test("refuses an unknown key in a response", () => {
    expect(issuesOf(User, user)).toEqual([]);
    expect(issuesOf(User, { ...user, passwordHash: "x" })).toEqual([": unrecognized_keys"]);
    const claim = clone(claimResponse);
    Object.assign(claim.deliveries[0]?.recommendation ?? {}, { content: {} });
    expect(issuesOf(ClaimResponse, claim)).toEqual(["deliveries.0.recommendation: unrecognized_keys"]);
  });

  test("refuses match terms in a delivery that are not normalized", () => {
    const claim = clone(claimResponse);
    const terms = claim.deliveries[1]?.recommendation.matchTerms;
    if (terms?.[0]) terms[0].text = "Make a Decision";
    expect(issuesOf(ClaimResponse, claim)).toEqual(["deliveries.1.recommendation.matchTerms.0.text: custom"]);
  });

  test("refuses an item key that does not fit the kind", () => {
    const claim = clone(claimResponse);
    const rec = claim.deliveries[0]?.recommendation;
    if (rec) rec.itemKey = "word:i saw it yesterday";
    expect(issuesOf(ClaimResponse, claim)).toEqual(["deliveries.0.recommendation.itemKey: custom"]);
  });

  test("sign-up checks the email, the password size, the language and the time zone", () => {
    const body = {
      email: "petr@example.com",
      password: "correct horse",
      displayName: "Petr",
      nativeLanguage: "ru",
    };
    expect(issuesOf(SignUpBody, body)).toEqual([]);
    expect(
      issuesOf(SignUpBody, {
        ...body,
        email: "petr",
        password: "short",
        nativeLanguage: "RU",
      }),
    ).toEqual(["email: invalid_format", "password: too_small", "nativeLanguage: invalid_format"]);
  });

  test("queries: limit 1..100 with default 20, delivered is true or false", () => {
    expect(PageQuery.parse({})).toEqual({ limit: 20 });
    expect(PageQuery.parse({ limit: "50", cursor: "abc" })).toEqual({ limit: 50, cursor: "abc" });
    expect(issuesOf(PageQuery, { limit: "0" })).toEqual(["limit: too_small"]);
    expect(issuesOf(PageQuery, { limit: "101" })).toEqual(["limit: too_big"]);
    expect(RecommendationsQuery.parse({ delivered: "false" })).toEqual({ limit: 20, delivered: false });
    expect(issuesOf(RecommendationsQuery, { delivered: "yes" })).toEqual(["delivered: invalid_value"]);
  });

  test("claim limit 1..50 with default 20", () => {
    expect(ClaimBody.parse({ installationId: "ABCD-1234_efgh" }).limit).toBe(20);
    expect(issuesOf(ClaimBody, { installationId: "ABCD-1234_efgh", limit: 51 })).toEqual(["limit: too_big"]);
    expect(issuesOf(ClaimBody, { installationId: "short" })).toEqual(["installationId: invalid_format"]);
  });

  test("an error body carries a known code and optional issues", () => {
    expect(
      issuesOf(ErrorBody, {
        error: "validation_failed",
        issues: [{ path: "email", code: "invalid_format" }],
      }),
    ).toEqual([]);
    expect(issuesOf(ErrorBody, { error: "teapot" })).toEqual(["error: invalid_value"]);
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonColumnError, readJson, writeJson } from "../src/db/json";

const Settings = z.strictObject({
  intensity: z.enum(["light", "normal", "intense"]),
  names: z.array(z.string()),
});

describe("readJson", () => {
  it("parses a column with its schema", () => {
    expect(readJson('{"intensity":"light","names":["Petr"]}', Settings, "users.reminder_settings")).toEqual({
      intensity: "light",
      names: ["Petr"],
    });
  });

  it("names the column when the text is not JSON", () => {
    expect(() => readJson('{"intensity":', Settings, "users.reminder_settings")).toThrow(
      new JsonColumnError("users.reminder_settings", "not valid JSON"),
    );
  });

  it("names the column and the failing paths, never the stored value", () => {
    let error: unknown;
    try {
      readJson('{"intensity":"private words","names":[42]}', Settings, "users.reminder_settings");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(JsonColumnError);
    const message = (error as JsonColumnError).message;
    expect(message).toBe(
      "json column users.reminder_settings: does not match its schema: intensity invalid_value, names.0 invalid_type",
    );
    expect(message).not.toContain("private words");
  });
});

describe("writeJson", () => {
  it("serializes a value that readJson reads back", () => {
    const value = { intensity: "intense" as const, names: ["A", "Б"] };
    expect(readJson(writeJson(value), Settings, "users.reminder_settings")).toEqual(value);
  });

  it("refuses a value without a JSON form", () => {
    expect(() => writeJson(undefined)).toThrow(/no JSON form/);
  });
});

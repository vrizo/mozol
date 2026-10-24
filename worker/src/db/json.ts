// JSON columns: text holding valid JSON, parsed with a zod schema on every read (docs/backend/data-model.md).
// Errors name the column and the failing paths, never the stored value: it may hold learning content.
import type { z } from "zod";

export class JsonColumnError extends Error {
  constructor(
    readonly column: string,
    reason: string,
  ) {
    super(`json column ${column}: ${reason}`);
    this.name = "JsonColumnError";
  }
}

export function readJson<T extends z.ZodType>(text: string, schema: T, column: string): z.output<T> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new JsonColumnError(column, "not valid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"} ${i.code}`);
    throw new JsonColumnError(column, `does not match its schema: ${issues.join(", ")}`);
  }
  return result.data;
}

export function writeJson(value: unknown): string {
  const text: string | undefined = JSON.stringify(value);
  if (text === undefined) throw new Error("writeJson: the value has no JSON form");
  return text;
}

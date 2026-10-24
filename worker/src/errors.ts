// API errors as `{ "error": "<code>" }` with a matching status (shared/CONTRACT.md, Errors).
import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { AppEnv } from "./env";
import { logError } from "./log";

export type Issue = { path: string; code: string };

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    readonly issues?: Issue[],
  ) {
    super(code);
    this.name = "ApiError";
  }
}

// A request body or query that does not match its schema.
export class RequestValidationError extends Error {
  constructor(readonly zodError: z.ZodError) {
    super("validation_failed");
    this.name = "RequestValidationError";
  }
}

// A request body that is not valid JSON.
export class BadJsonError extends Error {
  constructor() {
    super("bad_json");
    this.name = "BadJsonError";
  }
}

export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestValidationError(result.error);
  return result.data;
}

export async function readJson<T extends z.ZodType>(c: Context<AppEnv>, schema: T): Promise<z.output<T>> {
  const text = await c.req.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BadJsonError();
  }
  return parseInput(schema, value);
}

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.issues ? { error: err.code, issues: err.issues } : { error: err.code }, err.status);
  }
  if (err instanceof RequestValidationError) {
    const issues = err.zodError.issues.map((i) => ({ path: i.path.map(String).join("."), code: i.code }));
    return c.json({ error: "validation_failed", issues }, 400);
  }
  if (err instanceof BadJsonError) {
    return c.json({ error: "bad_json" }, 400);
  }
  logError(c.get("rid"), "error", { code: "internal", message: err.message });
  return c.json({ error: "internal" }, 500);
};

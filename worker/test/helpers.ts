// Requests to the worker in tests, and sign-up and app sign-in shortcuts for tests that need a user.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { AppCodeResponse, AppTokenResponse, ErrorBody, type User, UserResponse } from "shared";
import { expect } from "vitest";
import type { Env } from "../src/env";
import app from "../src/index";

export const PASSWORD = "correct horse battery";

export type CallOptions = {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  bearer?: string;
  // The Origin header of a request with a method other than GET; null sends none.
  origin?: string | null;
  // CF-Connecting-IP; a new random address when missing, so the auth rate limit never mixes tests.
  ip?: string | null;
  headers?: Record<string, string>;
  // Bindings that replace the test environment's ones for this request, such as a failing workflow binding.
  bindings?: Partial<Env>;
};

export function randomIp(): string {
  const [a, b, c] = crypto.getRandomValues(new Uint8Array(3));
  return `10.${a}.${b}.${c}`;
}

export async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const method =
    options.method ?? (options.body === undefined && options.rawBody === undefined ? "GET" : "POST");
  const headers = new Headers(options.headers);
  const ip = options.ip === undefined ? randomIp() : options.ip;
  if (ip !== null) headers.set("CF-Connecting-IP", ip);
  if (options.cookie !== undefined) headers.set("Cookie", `mozol_session=${options.cookie}`);
  if (options.bearer !== undefined) headers.set("Authorization", `Bearer ${options.bearer}`);
  const origin = options.origin === undefined ? env.APP_ORIGIN : options.origin;
  if (method !== "GET" && origin !== null) headers.set("Origin", origin);
  let body: string | undefined = options.rawBody;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  const request = new Request(`http://localhost${path}`, { method, headers, body });
  if (options.bindings === undefined) return exports.default.fetch(request);
  const ctx = createExecutionContext();
  const res = await app.fetch(request, { ...env, ...options.bindings }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function expectError(res: Response, status: number, code: string): Promise<ErrorBody> {
  expect(res.status).toBe(status);
  const body = ErrorBody.parse(await res.json());
  expect(body.error).toBe(code);
  return body;
}

// The mozol_session value of the response's Set-Cookie header.
export function sessionCookie(res: Response): string {
  const header = res.headers.getSetCookie().find((v) => v.startsWith("mozol_session="));
  if (header === undefined) throw new Error("sessionCookie: the response sets no mozol_session cookie");
  return header.slice("mozol_session=".length).split(";")[0] ?? "";
}

export function signUpBody(overrides: Record<string, unknown> = {}) {
  return {
    email: `user.${crypto.randomUUID().slice(0, 8)}@Example.com`,
    password: PASSWORD,
    displayName: "Petr",
    nativeLanguage: "ru",
    ...overrides,
  };
}

export async function signUp(overrides: Record<string, unknown> = {}): Promise<{
  user: User;
  email: string;
  cookie: string;
}> {
  const body = signUpBody(overrides);
  const res = await call("/api/auth/sign-up", { body });
  expect(res.status).toBe(201);
  const { user } = UserResponse.parse(await res.json());
  return { user, email: body.email, cookie: sessionCookie(res) };
}

export async function appCode(cookie: string): Promise<AppCodeResponse> {
  const res = await call("/api/auth/app-code", { method: "POST", cookie });
  expect(res.status).toBe(201);
  return AppCodeResponse.parse(await res.json());
}

// Signs in the "app" of a web user through the handoff and returns the app session token.
export async function appToken(cookie: string, installationId = "install-0001"): Promise<string> {
  const { code } = await appCode(cookie);
  const res = await call("/api/auth/app-token", { body: { code, installationId } });
  expect(res.status).toBe(201);
  return AppTokenResponse.parse(await res.json()).token;
}

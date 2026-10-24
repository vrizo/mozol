// The MOZOL worker: the API under /api/. Every other path is the web build, served by the assets binding.
import { Hono } from "hono";
import { HealthResponse } from "shared";
import type { AppEnv } from "./env";
import { onError } from "./errors";
import { requestId } from "./request-id";

const app = new Hono<AppEnv>();

app.use(requestId);
app.onError(onError);

app.get("/api/health", (c) => c.json(HealthResponse.parse({ ok: true })));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;

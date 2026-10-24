// The MOZOL worker: the API under /api/. Every other path is the web build, served by the assets binding.
import { Hono } from "hono";
import { HealthResponse } from "shared";
import { loadSession } from "./auth/session";
import type { AppEnv } from "./env";
import { onError } from "./errors";
import { requestId } from "./request-id";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";

const app = new Hono<AppEnv>();

app.use(requestId);
app.use("/api/*", loadSession);
app.onError(onError);

app.get("/api/health", (c) => c.json(HealthResponse.parse({ ok: true })));
app.route("/api/auth", authRoutes);
app.route("/api/me", meRoutes);

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;

// The MOZOL worker: the API under /api/ and the AnalyzeTranscript workflow. Every other path is the web build,
// served by the assets binding.
import { Hono } from "hono";
import { HealthResponse } from "shared";
import { loadSession } from "./auth/session";
import type { AppEnv } from "./env";
import { onError } from "./errors";
import { requestId } from "./request-id";
import { authRoutes } from "./routes/auth";
import { connectionRoutes, sourceRoutes } from "./routes/connections";
import { deliveryRoutes } from "./routes/deliveries";
import { deviceRoutes } from "./routes/devices";
import { hookRoutes } from "./routes/hooks";
import { patternRoutes, wordRoutes } from "./routes/knowledge";
import { meRoutes } from "./routes/me";
import { recommendationRoutes } from "./routes/recommendations";
import { transcriptRoutes } from "./routes/transcripts";

export { AnalyzeTranscript } from "./pipeline/workflow";

const app = new Hono<AppEnv>();

app.use(requestId);
app.use("/api/*", loadSession);
app.onError(onError);

app.get("/api/health", (c) => c.json(HealthResponse.parse({ ok: true })));
app.route("/api/auth", authRoutes);
app.route("/api/me", meRoutes);
app.route("/api/sources", sourceRoutes);
app.route("/api/connections", connectionRoutes);
app.route("/api/devices", deviceRoutes);
app.route("/api/hooks", hookRoutes);
app.route("/api/transcripts", transcriptRoutes);
app.route("/api/patterns", patternRoutes);
app.route("/api/words", wordRoutes);
app.route("/api/recommendations", recommendationRoutes);
app.route("/api/deliveries", deliveryRoutes);

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;

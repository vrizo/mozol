// Zod schemas of the API contract (shared/CONTRACT.md), used by the worker and the web app.
import { z } from "zod";

export const HealthResponse = z.object({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;

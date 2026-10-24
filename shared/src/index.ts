// Zod schemas of the API contract (shared/CONTRACT.md), used by the worker and the web app.
import { z } from "zod";

export const HealthResponse = z.strictObject({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;

export * from "./accounts";
export * from "./analysis";
export * from "./common";
export * from "./devices";
export * from "./knowledge";
export * from "./matching";
export * from "./push";
export * from "./recommendations";
export * from "./sources";
export * from "./transcripts";

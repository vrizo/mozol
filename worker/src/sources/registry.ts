// Every source MOZOL accepts. Adding a source is one adapter module and one entry here (docs/product/sources.md).
import type { SourceId } from "shared";
import { jamieAdapter } from "./jamie";
import { jsonAdapter } from "./json";
import { pasteAdapter } from "./paste";
import type { SourceAdapter } from "./types";

export const sources: Record<SourceId, SourceAdapter> = {
  jamie: jamieAdapter,
  paste: pasteAdapter,
  json: jsonAdapter,
};

export function sourceById(id: string): SourceAdapter | null {
  return Object.hasOwn(sources, id) ? sources[id as SourceId] : null;
}

// Vite plugin that answers /api with the in-memory mock (mock/api.ts) instead of the worker. Used by `pnpm dev:mock`.
import type { Plugin } from "vite";

// The parts of Node's request and response the plugin uses; the web package has no Node types.
type NodeRequest = AsyncIterable<Uint8Array> & {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};
type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string | string[]): void;
  end(body: Uint8Array): void;
};

export function mockApi(): Plugin {
  return {
    name: "mozol-mock-api",
    configureServer(server) {
      server.middlewares.use(async (nodeReq, nodeRes, next) => {
        const req = nodeReq as unknown as NodeRequest;
        const res = nodeRes as unknown as NodeResponse;
        if (!req.url?.startsWith("/api/")) return next();
        try {
          const { handle } = (await server.ssrLoadModule("/mock/api.ts")) as typeof import("./api");
          const chunks: Uint8Array[] = [];
          for await (const chunk of req) chunks.push(chunk);
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === "string") headers.set(key, value);
            else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
          }
          const hasBody = req.method !== "GET" && req.method !== "HEAD" && chunks.length > 0;
          const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
            method: req.method,
            headers,
            body: hasBody ? new Blob(chunks as BlobPart[]) : undefined,
          });
          const response = await handle(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key !== "set-cookie") res.setHeader(key, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length > 0) res.setHeader("Set-Cookie", cookies);
          res.end(new Uint8Array(await response.arrayBuffer()));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

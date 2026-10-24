import { defineConfig } from "vite";
import { mockApi } from "./mock/plugin.ts";

// The web package has no Node types; the config only reads one variable.
declare const process: { env: Record<string, string | undefined> };

// React JSX through the built-in transform; /api goes to the local worker in dev, or to the in-memory mock
// (mock/api.ts) when MOZOL_MOCK=1.
const mock = process.env.MOZOL_MOCK === "1";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  plugins: mock ? [mockApi()] : [],
  server: {
    port: 5190,
    strictPort: true,
    proxy: mock ? undefined : { "/api": "http://localhost:8790" },
  },
});

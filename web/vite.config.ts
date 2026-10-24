import { defineConfig } from "vite";

// React JSX through the built-in transform; /api goes to the local worker in dev.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  server: {
    port: 5190,
    strictPort: true,
    proxy: { "/api": "http://localhost:8790" },
  },
});

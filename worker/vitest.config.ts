import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The migrations are read here in Node.js and applied to the test D1 by test/apply-migrations.ts.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});

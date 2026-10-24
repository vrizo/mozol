import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The migrations are read here in Node.js and applied to the test D1 by test/apply-migrations.ts.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // Tests never call the model or APNs, whatever worker/.dev.vars says.
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ANALYSIS_MODE: "fixture", PUSH_MODE: "log" },
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});

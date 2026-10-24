Dependency rules

Keep dependencies few. Planned set — root: pnpm workspace, biome, typescript; shared: zod and vitest (tests); worker: hono, zod, @anthropic-ai/sdk (the Claude API client), wrangler, vitest, @cloudflare/vitest-plugin and @cloudflare/workers-types; web: react, react-dom, zod (types of the shared schemas), vite, vitest, @types/react and @types/react-dom (types for strict TypeScript), and the workspace package shared; iOS: no third-party packages. Anything beyond this needs a reason in the commit message, and this file is updated in the same commit.

No package version younger than 72 hours: check the publish date (`npm view <pkg>@<version> time`) before adding anything. If it is too fresh, pin the previous version.

Node 24 or newer, pnpm as the package manager. Lint and format with biome from the repo root.

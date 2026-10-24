Dependency rules

Keep dependencies few. Planned set — root: pnpm workspace, biome, typescript; worker: hono, zod, wrangler, vitest, the Cloudflare test and types packages; web: react, react-dom, vite, vitest; iOS: no third-party packages. Anything beyond this needs a reason in the commit message, and this file is updated in the same commit.

No package version younger than 72 hours: check the publish date (`npm view <pkg>@<version> time`) before adding anything. If it is too fresh, pin the previous version.

Node 24 or newer, pnpm as the package manager. Lint and format with biome from the repo root.

Web app rules

Stack

- React with TypeScript, built by Vite, in web/ (pnpm workspace package `web`). The build is static files served by the worker at https://mozol.vrizo.net. In dev, Vite proxies /api/ to the local worker on port 8790, so the app always calls relative /api/ paths.
- Function components and hooks only. No class components.
- Strict TypeScript. No `any`; data from the API is parsed with the zod schemas from shared/ before use.
- One API client module (web/src/api.ts). Components never call fetch directly. Every request carries `X-Request-Id`, minted per request, and logs it with the route and the status.
- No global state library. State lives in the component that owns it; shared state goes in a React context.
- The view state lives in the URL (route, filters, open item), so a reload shows the same screen.
- Lint and format with biome. Tests with vitest.

Errors

- No silent fallbacks. A failed request shows what failed and its error code (../rules/ui-copy.md), and the user can retry.
- Loading, empty and error states are designed for every screen, not only the success state.

Accessibility

- Every page renders one main landmark with id="main-content"; a skip link at the top targets it.
- Focus style is one global :focus-visible rule. Components do not override it.
- Every control is reachable and usable with the keyboard. Buttons are <button>, links are <a>.
- Images carry alt text; decorative images carry alt="".
- Color contrast meets WCAG 2.1 AA.
- The layout works at phone width (360 px) without horizontal scroll.

Copy: all strings in web/src/copy/en.ts, rules in ../rules/ui-copy.md.

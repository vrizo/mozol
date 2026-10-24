Docs index

Fixed specification of MOZOL: features, product decisions, technical decisions. Not a codebase walkthrough — the code explains itself. How to write these files: rules/writing-docs.md.

- architecture/ — how the iOS app, the web app, the worker and the database fit together
- product/ — the idea, features (accounts, sources, analysis, reminders, web app), pending decisions
- ios/ — iOS app rules, testing
- web/ — React web app rules
- backend/ — worker rules, data model, pipeline, AI analysis, push, source formats
- deployment/ — infrastructure, deploy by agents
- security/ — Cloudflare tokens
- logs/ — log layout and reading rules
- rules/ — repo-wide rules: writing docs, UI copy, assets, dependencies

The pinned API contract lives outside docs on purpose: shared/CONTRACT.md, source of truth for the apps and the worker.

W05 Patterns and words

Track: web. Depends on: W02, B08. Next: W06.

Goal

The user sees their recurring mistakes and suggested words across all transcripts and sources, and marks them as learned, known or dismissed.

Read first

- AGENTS.md, plan/README.md
- docs/product/web-app.md (Patterns, Words), docs/product/analysis.md (Patterns, Words), docs/rules/ui-copy.md
- shared/CONTRACT.md: Pattern, Word, "Endpoints: patterns and words"
- web/src/ from W01 to W04

Do

1. Patterns (/patterns): tabs for active, learned and dismissed (the tab lives in the URL, ?status=) and a language filter (?language=, shown when the user has more than one language). Each pattern: language, title, category, a recurring mark, occurrences and number of transcripts, sources, last seen date, the latest example (quote and correction), explanation, tip. Actions: mark as learned, dismiss, make active again. The list updates after an action without a full reload.
2. Words (/words): tabs for new, learning, known and dismissed (?status=) and the same language filter. Each word: language, term, type, translation, meaning, example and its translation, times suggested, last seen. Actions: learning, known, dismiss, new.
3. Empty states say where patterns and words come from and link to Sources.
4. Strings in web/src/copy/en.ts by the copy subagent.

Checks

- vitest for pure helpers (formatting counts and dates).
- `pnpm --filter web test`, `pnpm --filter web build`, `pnpm lint`
- Browser against the local stack in fixture mode, after two Jamie fixtures were analyzed: patterns show as recurring with 2 transcripts; mark one learned (it moves to the learned tab); dismiss a word; reload keeps the tab. 360 px and 1280 px. Screenshots to tests/screenshots/<date>/. Close your tabs.

Out of scope

Reminder pages (W06).

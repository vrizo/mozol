Writing docs

Docs are a fixed specification: features, product decisions, technical decisions. Never an explanation of the codebase — the code explains itself.

- Very simple English, short. A reader with basic English must understand every sentence.
- One topic per file, files grouped in topic folders under docs/. Split a topic into a subfolder when it grows past a few files.
- Record final decisions as current facts. No reasoning for why an option was chosen, no rejected alternatives.
- Never describe previous solutions, migrations, legacy behavior, or what something replaced. Never label things "new".
- Say what exists, not what does not.
- No comparisons to alternatives and no marketing.
- Minimum markdown: a plain title line, paragraphs, dashes. Tables only for real tables.
- Do not overcompress. Short limits content, not clarity — a human must be able to read the file cold, without decoding abbreviations.
- Do not repeat other docs; keep one topic in one file and link to the other doc. Do not restate rules from AGENTS.md.
- Absolute dates ("2026-10-24", not "yesterday").
- An open question goes to product/pending.md, not into the spec.
- The banned words and register rules in AGENTS.md "Writing style" apply.

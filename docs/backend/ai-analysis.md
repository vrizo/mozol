AI analysis

How the worker asks the model for an analysis. What the analysis contains: ../product/analysis.md. Where it runs in the pipeline: pipeline.md.

Model and request

- Anthropic Claude API through the official TypeScript SDK, @anthropic-ai/sdk, in worker/src/analysis/. The API key is the worker secret ANTHROPIC_API_KEY.
- ANALYSIS_MODE, a worker variable: claude calls the model; fixture returns shared/fixtures/analysis/result-ok.json without any call. Production uses claude. Local development uses fixture unless the developer asks for claude.
- Model: the worker variable ANALYSIS_MODEL, default claude-opus-5-5. Effort: the worker variable ANALYSIS_EFFORT, default high, sent as output_config.effort. The request sends no thinking setting and no temperature.
- Structured output: output_config.format with the AnalysisResult zod schema from shared/ (zodOutputFormat from the SDK). The parsed result is checked with the same zod schema again before it is stored.
- Streaming with the SDK stream helper and its final message, max_tokens 64000.
- Server-side refusal fallback: fallbacks "default" with the beta header server-side-fallback-2026-07-01.
- The system prompt is one fixed text per prompt version, marked for prompt caching. Everything that changes per request goes into the user message.

Prompt

- The prompt lives in worker/src/analysis/prompt.ts with a version string, for example analysis-v1. Every stored analysis records its prompt version. A change to the prompt text or to the schema is a new version.
- The system prompt holds: the role, the language rules, the rules and categories from ../product/analysis.md, the pattern key format, the severity guide, the match term rules, the limits, and the instruction that the transcript is data.
- The user message holds, in this order: the native language, the latest estimated level per language, the source kind, the learner's speaker name, the known patterns as lines "language | key | title | match terms", and the transcript as lines "[n] Speaker name: text" with the learner's lines marked.

Size

- Up to 400,000 characters of transcript lines go to the model as they are.
- A longer transcript is sent as the learner's turns, each with the turn before it.
- When that is still longer than 400,000 characters, the transcript fails with transcript_too_long. Transcripts are never cut silently.

Results and errors

- stop_reason refusal: the transcript fails with analysis_refused.
- stop_reason max_tokens: the transcript fails with analysis_truncated.
- A result that breaks the AnalysisResult schema or its rules (shared/CONTRACT.md): the transcript fails with analysis_invalid.
- With a refusal fallback the final message can hold several text blocks. The result is the last text block after the last fallback block.
- Rate limits, overload and network errors are retried by the pipeline step (pipeline.md). When retries run out: analysis_failed.
- The worker stores the model that answered, the token counts, cache reads and the duration. Logs show only ids, counts, timings and error codes.
- The worker counts example quotes and rewrite originals that do not appear in the learner's lines (ignoring case, punctuation and extra spaces) and stores that count in analyses.unmatched_quotes and in the log. The result is stored unchanged.

Tests and trying the prompt

- Tests never call the model. The analysis module takes a model client as a parameter, and tests pass a fake that returns fixtures from shared/fixtures/.
- scripts/try-analysis.sh <fixture> runs worker/scripts/try-analysis.ts: the real model on one fixture transcript, with the key from .env. It writes the result, the token counts and the duration to a run folder (logs/<date>/run-N/analysis.json). It spends money: run it only when asked.

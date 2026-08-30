# BAGL — extensible RAG orchestrator in BAML

Sibling to `bi` under `orion-learn-baml/` — the repo you use to orchestrate the BAML projects you decide to make.

**Objectives (same as bi):**

1. **Learn language design** — BAML's expression-oriented, interface + `match`, prompt-as-schema DSL.
2. **Have fun making BAML projects** — this one is RAG: chunk → embed → retrieve → generate.
3. **Contribute to BAML** — surface real issues in the field (same `proposals/` pattern as `bi`).

**Stack:**

- `baml_src/main.baml` — `Chunker` / `Embedder` / `Retriever` interfaces, `NaiveChunker`/`NaiveEmbedder` (offline), `RagContext`, `ingest`/`retrieve`/`AnswerQuestion`/`RagAnswer`. Host provides concrete chunkers/embedders/retrievers (vector DB, etc.).
- `baml_sdk/` — generated TS SDK (`baml generate`, `preserve-case`).
- `src/cli.ts` — `bagl` CLI (`ask` today, `ingest`/`retrieve` next).

**Quickstart:**

```bash
cd bagl
npm install
baml check && baml test --list && baml generate
npm run build
node dist/src/cli.js --help
```

BAML docs: `baml describe baml.json`, `baml describe baml.media.Image`, `baml check`, `baml run -e '...'` — the CLI is the docs (see `../.agents/skills/baml-core/SKILL.md`).

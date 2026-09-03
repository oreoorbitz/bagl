# AGENTS.md — bagl

> Read `../AGENTS.md` first — this file is the `bagl` specialization.

## What this is

Extensible RAG orchestrator — chunk → embed → retrieve → generate. BAML owns the contract, host owns the engine (no `pg` import in BAML).

* `baml_src/main.baml` `Chunker/Embedder/Retriever` + `NaiveChunker/NaiveEmbedder` + `HostRetriever` + `RagContext`, `ingest/retrieve/AnswerQuestion/RagAnswer`
* `baml_src/vector_store.baml` `VectorStore{upsert,search,count}` — `InMemoryVectorStore` for offline tests
* `baml_src/ranker.baml` `Ranker{rank}` — `IdentityRanker/ScoreBoostRanker`

## Toolchain

Pinned `0.17.0` (wrapper `0.2.4`, toolchain `0.17.0 canary`, bridge `0.17.0` —
SDK and bridge versions must match).

```
baml check --project bagl    # 4 files Finished
baml test --project bagl     # 7 passed
baml generate --project bagl # 68 files
```

## Project wiring

* `baml.toml` `[dependencies] bais = { path = "../bais" }` (ignored by the
  0.17.0 toolchain; BAIS interop stays at the TS-host level via bais's BAML
  parser, same as bi).
* `0.17.0` compat: `Chunker.name`/`Embedder.dim`/`VectorStore.count`
  `throws never`, `AnswerQuestion ${ctx.output_format}` (no call parens).
* BAIS is first-class: `bagl bais list/ready/new/move/check/graph` with the
  same hardened surface as bi (`unparseable` never silent, Missing fails,
  cycles diagnosed + fatal, scoped new ids).
* Host providers `src/providers/voyage.ts` + `openai.ts` + `src/vector_store/host.ts` `HostVectorStore` delegation (postgres/pgvector/sqlite-vec/Qdrant/file JSON).


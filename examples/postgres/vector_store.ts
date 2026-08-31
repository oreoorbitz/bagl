// bagl/examples/postgres/vector_store.ts — 15-line postgres/pgvector example (not a BAGL dep).
// Shows how to implement VectorStore host-side without BAGL importing `pg`.
// Run: npm install pg pgvector && VOYAGE_API_KEY=... node --loader ts-node/esm examples/postgres/vector_store.ts

// import { Pool } from "pg"; // only inside this example, not in bagl/package.json
// import { HostVectorStore } from "../../src/vector_store/host.js";
//
// const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// export const pgVectorStore = new HostVectorStore({
//   upsert: async (chunks) => {
//     for (const c of chunks) {
//       await pool.query(
//         "INSERT INTO bagl_chunks (id, doc_id, text, embedding) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET embedding=$4",
//         [c.chunk_id, c.doc_id, c.text, JSON.stringify(c.embedding)],
//       );
//     }
//   },
//   search: async (queryEmbedding, k) => {
//     const { rows } = await pool.query(
//       "SELECT chunk_id, doc_id, text, embedding, embedding <=> $1::vector AS score FROM bagl_chunks ORDER BY embedding <=> $1::vector LIMIT $2",
//       [JSON.stringify(queryEmbedding), k],
//     );
//     return rows.map((r) => ({ chunk: { doc_id: r.doc_id, chunk_id: r.chunk_id, text: r.text, embedding: r.embedding }, score: 1 - r.score }));
//   },
//   count: async () => (await pool.query("SELECT COUNT(*) FROM bagl_chunks")).rows[0].count,
// });
//
// Then pass `pgVectorStore` as `VectorStore` to BAML `vector_store.baml` functions
// or to `bagl/src/bais.ts`-style host orchestration. BAGL itself never imports `pg`.

export const postgresExampleNote = "See comments above — implement VectorStore via HostVectorStore without adding pg to bagl/package.json";

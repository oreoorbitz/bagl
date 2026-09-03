// bagl/baml_src/vector_store.baml — VectorStore interface, no NIH.
// BAML owns the *contract* (upsert/search/count); the host owns the
// *engine* (postgres/pgvector, sqlite-vec, Qdrant, file JSON). This file
// ships only the pure-BAML InMemoryVectorStore for offline tests — the
// same brute-force dot-product as `retrieve` in main.baml.
// Host-provided stores implement the same VectorStore interface in TypeScript
// and are passed as `VectorStore` values (interface dispatch) without BAGL
// importing `pg`.

interface VectorStore {
    function upsert(self, chunks: Chunk[]) -> void throws baml.errors.InvalidArgument
    function search(self, query_embedding: float[], k: int) -> RetrievedDoc[] throws baml.errors.InvalidArgument
    function count(self) -> int throws never
}

class InMemoryVectorStore {
    store: Chunk[],
    implements VectorStore {
        function upsert(self, chunks: Chunk[]) -> void {
            for (let c in chunks) {
                self.store.push(c)
            }
        }
        function search(self, query_embedding: float[], k: int) -> RetrievedDoc[] {
            if (query_embedding.length() == 0) {
                throw baml.errors.InvalidArgument { message: "empty query embedding" }
            }
            if (k <= 0) {
                throw baml.errors.InvalidArgument { message: "k must be > 0" }
            }
            let scored: RetrievedDoc[] = [];
            for (let ch in self.store) {
                let emb = ch.embedding ?? [];
                let s = cosine(query_embedding, emb);
                scored.push(RetrievedDoc { chunk: ch, score: s })
            }
            scored.sort_by((a, b) -> {
                if (a.score > b.score) {
                    -1
                } else if (a.score < b.score) {
                    1
                } else {
                    0
                }
            });
            let n = if (k < scored.length()) { k } else { scored.length() };
            let out: RetrievedDoc[] = [];
            for (let i = 0; i < n; i += 1) {
                out.push(scored[i])
            }
            out
        }
        function count(self) -> int throws never {
            self.store.length()
        }
    }
}

function vector_store_new() -> InMemoryVectorStore {
    InMemoryVectorStore { store: [] }
}

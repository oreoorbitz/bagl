// bagl/baml_src/ranker.baml — Ranker interface, extensible without bundling a model.
// Voyage rerank-2 / Cohere rerank are host classes wrapping POST /v1/rerank.
// BAML ships only IdentityRanker (no-op, keeps scores) for offline tests.

interface Ranker {
    function rank(self, query: string, candidates: RetrievedDoc[]) -> RetrievedDoc[] throws baml.errors.InvalidArgument
}

class IdentityRanker {
    implements Ranker {
        function rank(self, query: string, candidates: RetrievedDoc[]) -> RetrievedDoc[] {
            candidates
        }
    }
}

class ScoreBoostRanker {
    // Deterministic test double: boosts score of candidates whose chunk.text includes `needle`.
    needle: string,
    boost: float,
    implements Ranker {
        function rank(self, query: string, candidates: RetrievedDoc[]) -> RetrievedDoc[] {
            let out: RetrievedDoc[] = [];
            for (let c in candidates) {
                let s = c.score;
                if (c.chunk.text.includes(self.needle)) {
                    s = s + self.boost
                }
                out.push(RetrievedDoc { chunk: c.chunk, score: s })
            }
            out.sort_by((a, b) -> {
                if (a.score > b.score) {
                    -1
                } else if (a.score < b.score) {
                    1
                } else {
                    0
                }
            });
            out
        }
    }
}

function rerank(query: string, candidates: RetrievedDoc[], ranker: Ranker) -> RetrievedDoc[] {
    ranker.rank(query, candidates)
}

// Neighborhood booster for ask --for (bagl#07): boosts candidates whose
// chunk belongs to one of the given doc ids (BAIS issue neighborhood),
// then re-sorts. Same deterministic shape as ScoreBoostRanker, keyed on
// doc_id instead of text — the host passes plain ids, never a Ranker
// handle (host interface handles do not round-trip; cf. ingest_docs).
class DocBoostRanker {
    doc_ids: string[],
    boost: float,
    implements Ranker {
        function rank(self, query: string, candidates: RetrievedDoc[]) -> RetrievedDoc[] {
            let out: RetrievedDoc[] = [];
            for (let c in candidates) {
                let s = c.score;
                if (self.doc_ids.includes(c.chunk.doc_id)) {
                    s = s + self.boost
                }
                out.push(RetrievedDoc { chunk: c.chunk, score: s })
            }
            out.sort_by((a, b) -> {
                if (a.score > b.score) {
                    -1
                } else if (a.score < b.score) {
                    1
                } else {
                    0
                }
            });
            out
        }
    }
}

// Plain-data rerank wrapper (host boundary): boost + cut to k in-VM.
function rerank_by_docs(
    query: string,
    candidates: RetrievedDoc[],
    doc_ids: string[],
    boost: float,
    k: int,
) -> RetrievedDoc[] {
    let ranked = rerank(query, candidates, DocBoostRanker { doc_ids: doc_ids, boost: boost });
    let n = if (k < ranked.length()) {
        k
    } else {
        ranked.length()
    };
    let out: RetrievedDoc[] = [];
    for (let i = 0; i < n; i += 1) {
        out.push(ranked[i])
    }
    out
}

// One-shot scoped retrieval for ask --for: over-fetch, boost the issue
// neighborhood, cut to k. Chunks cross host->VM once (nudged plain data),
// top-k crosses back once — no handle ever crosses either way.
function ask_for_context(
    question: string,
    chunks: Chunk[],
    dim: int,
    k: int,
    doc_ids: string[],
    boost: float,
) -> RetrievedDoc[] {
    let cands = retrieve_chunks(question, chunks, dim, k * 3);
    rerank_by_docs(question, cands, doc_ids, boost, k)
}

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

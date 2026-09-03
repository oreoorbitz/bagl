testset "vector_store InMemory + ranker" {
    test "InMemory upsert/count" {
        let store = vector_store_new();
        assert.equal(store.count(), 0);
        let c1 = Chunk { doc_id: "d1", chunk_id: "d1#0", text: "hello", embedding: [1.0, 0.0, 0.0] };
        let c2 = Chunk { doc_id: "d1", chunk_id: "d1#1", text: "world", embedding: [0.0, 1.0, 0.0] };
        store.upsert([c1, c2]);
        assert.equal(store.count(), 2);
    }

    test "InMemory search ranks by dot product" {
        let store = vector_store_new();
        store.upsert(
            [
                Chunk { doc_id: "d1", chunk_id: "d1#0", text: "a", embedding: [1.0, 0.0] },
                Chunk { doc_id: "d2", chunk_id: "d2#0", text: "b", embedding: [0.0, 1.0] },
            ],
        );
        let res = store.search([1.0, 0.0], 1);
        assert.equal(res.length(), 1);
        assert.equal(res[0].chunk.chunk_id, "d1#0");
        let res2 = store.search([0.0, 1.0], 1);
        assert.equal(res2[0].chunk.chunk_id, "d2#0");
    }

    test "InMemory search k > n returns all" {
        let store = vector_store_new();
        store.upsert([Chunk { doc_id: "d1", chunk_id: "d1#0", text: "x", embedding: [1.0] }]);
        let res = store.search([1.0], 10);
        assert.equal(res.length(), 1);
    }

    test "InMemory search empty query throws" {
        let store = vector_store_new();
        let threw = false;
        let fallback: RetrievedDoc[] = [];
        let _ = store.search([], 1) catch (e) {
            baml.errors.InvalidArgument => {
                threw = true;
                fallback
            }
        };
        assert.is_true(threw);
    }

    test "IdentityRanker is no-op" {
        let r = IdentityRanker {  };
        let a = RetrievedDoc {
            chunk: Chunk { doc_id: "d1", chunk_id: "d1#0", text: "a", embedding: [1.0] },
            score: 1.0,
        };
        let b = RetrievedDoc {
            chunk: Chunk { doc_id: "d1", chunk_id: "d1#1", text: "b", embedding: [0.0] },
            score: 0.5,
        };
        let out = r.rank("q", [a, b]);
        assert.equal(out.length(), 2);
        assert.equal(out[0].chunk.chunk_id, "d1#0");
    }

    test "ScoreBoostRanker reorders" {
        let r = ScoreBoostRanker { needle: "needle", boost: 10.0 };
        let a = RetrievedDoc {
            chunk: Chunk { doc_id: "d1", chunk_id: "d1#0", text: "plain", embedding: [1.0] },
            score: 1.0,
        };
        let b = RetrievedDoc {
            chunk: Chunk { doc_id: "d1", chunk_id: "d1#1", text: "has needle", embedding: [1.0] },
            score: 0.5,
        };
        let out = r.rank("q", [a, b]);
        assert.equal(out[0].chunk.chunk_id, "d1#1");
        assert.is_true(out[0].score > out[1].score);
    }

    test "rerank delegates to Ranker" {
        let r = IdentityRanker {  };
        let a = RetrievedDoc {
            chunk: Chunk { doc_id: "d1", chunk_id: "d1#0", text: "a", embedding: [] },
            score: 1.0,
        };
        let out = rerank("q", [a], r);
        assert.equal(out.length(), 1);
    }
}

testset "plain-data host boundary" {
    test "ingest_docs chunks and embeds without host handles" {
        let docs = [
            Document { id: "d1", text: "bb bb", metadata: {} },
            Document { id: "d2", text: "aa aa", metadata: {} },
        ];
        let ctx = ingest_docs(docs, 100, 10, 4);
        assert.equal(ctx.chunks.length(), 2);
        assert.equal(ctx.chunks[0].chunk_id, "d1#0");
        assert.is_true((ctx.chunks[0].embedding ?? []).length() == 4);
    }

    test "retrieve_chunks ranks the better match first" {
        // Naive vectors: 'b' -> 2.0, 'a' -> 1.0; ranking is dot/(na+nb).
        // Query "bbbb" scores d1 (16/32) above d2 (8/20) — deterministic
        // without any host embedder.
        let docs = [
            Document { id: "d1", text: "bbbb", metadata: {} },
            Document { id: "d2", text: "aaaa", metadata: {} },
        ];
        let ctx = ingest_docs(docs, 100, 10, 4);
        let out = retrieve_chunks("bbbb", ctx.chunks, 4, 2);
        assert.equal(out.length(), 2);
        assert.equal(out[0].chunk.doc_id, "d1");
        assert.is_true(out[0].score > out[1].score);
    }

    test "retrieve_chunks k > n returns all" {
        let docs = [Document { id: "d1", text: "bb", metadata: {} }];
        let ctx = ingest_docs(docs, 100, 10, 4);
        let out = retrieve_chunks("b", ctx.chunks, 4, 10);
        assert.equal(out.length(), 1);
    }
}

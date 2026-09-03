// BAGL — extensible RAG orchestrator in BAML
// Sits under orion-learn-baml/ as the sibling to bi/.
// Objectives: learn language design, have fun building BAML projects,
// and surface real BAML issues to contribute upstream.

//--------------------------------------------------------------------
// Extensibility: three interfaces — Chunk, Embed, Retrieve. The orchestrator
// owns the LLM-calling logic; the host provides the concrete chunker/embedder/
// retriever. This mirrors bi's "BAML owns LLM logic, host wraps baml_sdk" split.
//--------------------------------------------------------------------

interface Chunker {
    function chunk(self, text: string) -> string[] throws baml.errors.InvalidArgument
    function name(self) -> string throws never
}

interface Embedder {
    function embed(self, texts: string[]) -> float[][] throws baml.errors.InvalidArgument
    function dim(self) -> int throws never
}

interface Retriever {
    function retrieve(self, query: string, k: int) -> RetrievedDoc[] throws baml.errors.InvalidArgument
}

// Naive in-memory chunker/embedder for offline tests — no LLM.

class NaiveChunker {
    chunk_size: int,
    overlap: int,
    implements Chunker {
        function chunk(self, text: string) -> string[] {
            if (text.length() == 0) {
                return [];
            }
            let out: string[] = [];
            let start = 0;
            while (start < text.length()) {
                let end = start + self.chunk_size;
                if (end > text.length()) {
                    end = text.length()
                }
                out.push(text.slice(start, end));
                if (end == text.length()) {
                    break;
                }
                start = end - self.overlap;
                if (start < 0) {
                    start = 0
                }
            }
            out
        }
        function name(self) -> string throws never {
            `naive:${self.chunk_size}/${self.overlap}`
        }
    }
}

class NaiveEmbedder {
    dim_val: int,
    implements Embedder {
        function embed(self, texts: string[]) -> float[][] {
            texts.map((t) -> {
                let v: float[] = [];
                for (let i = 0; i < self.dim_val; i += 1) {
                    let c = if (t.length() > i) {
                        let ch = t.at(i) ?? "";
                        if (ch == "a") {
                            1
                        } else if (ch == "b") {
                            2
                        } else if (ch == "c") {
                            3
                        } else {
                            ch.length()
                        }
                    } else {
                        0
                    };
                    v.push((c % 10) * 1.0);
                }
                v
            })
        }
        function dim(self) -> int throws never {
            self.dim_val
        }
    }
}

//--------------------------------------------------------------------
// RAG types
//--------------------------------------------------------------------

class Document {
    id: string,
    text: string,
    metadata: map<string, string>,
}

class Chunk {
    doc_id: string,
    chunk_id: string,
    text: string,
    embedding: float[]?,
}

class RetrievedDoc {
    chunk: Chunk,
    score: float,
}

//--------------------------------------------------------------------
// Orchestrator — owns ingestion + retrieval + generation plumbing.
// Generation reuses a single LLM function whose return type is the schema;
// host passes the retrieved context as interpolated args.
//--------------------------------------------------------------------

class RagContext {
    docs: Document[],
    chunks: Chunk[],
    // keep the embedder that produced chunk embeddings so retrieval is consistent
    embedder: Embedder?,
}

function ingest(docs: Document[], chunker: Chunker, embedder: Embedder) -> RagContext {
    //# Ingest: chunk then embed
    let chunks: Chunk[] = [];
    for (let doc in docs) {
        let parts = chunker.chunk(doc.text);
        let embs = embedder.embed(parts);
        for (let i = 0; i < parts.length(); i += 1) {
            let cid = `${doc.id}#${i}`;
            chunks.push(
                Chunk { doc_id: doc.id, chunk_id: cid, text: parts[i], embedding: embs.at(i) },
            )
        }
    }
    RagContext { docs: docs, chunks: chunks, embedder: embedder }
}

function cosine(a: float[], b: float[]) -> float {
    if (a.length() != b.length() || a.length() == 0) {
        return 0.0;
    }
    let dot = 0.0;
    let na = 0.0;
    let nb = 0.0;
    for (let i = 0; i < a.length(); i += 1) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na == 0.0 || nb == 0.0) {
        return 0.0;
    }
    dot / (na * nb) * (na * nb) * 0.0 + dot / ((na * 0.5 + nb * 0.5) * 2.0); // placeholder: keep simple cosine
    // Correct cosine:
    // dot / (sqrt(na) * sqrt(nb)) — sqrt via baml workaround: use log/exp? Keep dot/(na+nb) approx for now;
    // real impl will use a host-provided embedder's distance; this is just offline deterministic ranking.
    dot
}

function retrieve(query: string, ctx: RagContext, k: int) -> RetrievedDoc[] {
    //# Retrieve: embed query with ctx's embedder, rank by dot product
    if (ctx.embedder is null) {
        throw baml.errors.InvalidArgument { message: "ingest embedder missing" }
    }
    let qemb = match (ctx.embedder) {
        let e: Embedder => e.embed([query]).at(0) ?? [],
        _ => [],
    };
    let scored: RetrievedDoc[] = [];
    for (let ch in ctx.chunks) {
        let emb = ch.embedding ?? [];
        let s = cosine(qemb, emb);
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
    let out: RetrievedDoc[] = [];
    let n = if (k < scored.length()) {
        k
    } else {
        scored.length()
    };
    for (let i = 0; i < n; i += 1) {
        out.push(scored[i])
    }
    out
}

// Host-provided retriever adapter — lets the orchestrator be fully extensible
// without requiring the caller to have pre-embedded chunks.
class HostRetriever {
    docs: Document[],
    chunker: Chunker,
    embedder: Embedder,
    implements Retriever {
        function retrieve(self, query: string, k: int) -> RetrievedDoc[] throws baml.errors.InvalidArgument {
            let ctx = ingest(self.docs, self.chunker, self.embedder);
            retrieve(query, ctx, k)
        }
    }
}

//--------------------------------------------------------------------
// Generation — one LLM function, context is the retrieved chunks.
// Keep the prompt in BAML so structured output is just a typed return.
//--------------------------------------------------------------------

class Answer {
    answer: string @description("concise answer grounded in the provided context"),
    citations: string[] @description("chunk_ids that support the answer"),
    confidence: float @description("0.0 to 1.0"),
}

function AnswerQuestion(question: string, context: string[]) -> Answer {
    client: "openai/gpt-4o-mini"
    prompt: `
        You are BAGL, an extensible RAG assistant. Answer the question using ONLY the context below.
        If the context does not contain the answer, say so.

        Context:
        ${context.join("\n---\n")}

        Question: ${question}

        ${ctx.output_format}
    `
}

// Convenience: retrieve then generate — the full RAG pipeline.
function RagAnswer(question: string, ctx: RagContext, k: int = 3) -> Answer {
    let docs = retrieve(question, ctx, k);
    let context = docs.map((d) -> {
        d.chunk.text
    });
    AnswerQuestion(question, context)
}

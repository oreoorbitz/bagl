// bagl/src/providers/voyage.ts — host Voyage embedding & rerank (no BAGL dep on pg).
// BAML defines Embedder/VectorStore/Ranker interfaces; this host implements them
// via fetch to api.voyageai.com/v1 (OpenAI-style REST). Keeps BAGL agnostic.

import { fetchWithRetry } from "./http.js";

export type VoyageModel =
	| "voyage-4-large"
	| "voyage-4"
	| "voyage-4-lite"
	| "voyage-code-4"
	| "voyage-3-large"
	| "voyage-3"
	| "voyage-3-lite"
	| "voyage-finance-2"
	| "voyage-law-2";

export type VoyageRerankModel = "rerank-2" | "rerank-2-lite" | "rerank-2.5" | "rerank-2.5-lite";

export class VoyageEmbedder {
	constructor(
		public apiKey: string = process.env.VOYAGE_API_KEY ?? "",
		public model: VoyageModel = "voyage-4-large",
		public inputType: "query" | "document" = "document",
		public outputDimension: 1024 | 256 | 512 | 2048 = 1024,
	) {}
	dim(): number {
		return this.outputDimension;
	}
	async embed(texts: string[]): Promise<number[][]> {
		if (!this.apiKey) throw new Error("VOYAGE_API_KEY missing for VoyageEmbedder");
		const res = await fetchWithRetry("voyage embed", "https://api.voyageai.com/v1/embeddings", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ input: texts, model: this.model, input_type: this.inputType, output_dimension: this.outputDimension }),
		});
		if (!res.ok) throw new Error(`Voyage embed ${res.status}: ${await res.text()}`);
		const j = (await res.json()) as { data: { embedding: number[] }[] };
		return j.data.map((d) => d.embedding);
	}
}

export class VoyageRanker {
	constructor(
		public apiKey: string = process.env.VOYAGE_API_KEY ?? "",
		public model: VoyageRerankModel = "rerank-2",
	) {}
	async rank(query: string, documents: string[], topK?: number): Promise<{ index: number; relevance_score: number }[]> {
		if (!this.apiKey) throw new Error("VOYAGE_API_KEY missing for VoyageRanker");
		const body: any = { model: this.model, query, documents };
		if (topK) body.top_k = topK;
		const res = await fetchWithRetry("voyage rerank", "https://api.voyageai.com/v1/rerank", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`Voyage rerank ${res.status}: ${await res.text()}`);
		const j = (await res.json()) as { data: { index: number; relevance_score: number }[] };
		return j.data;
	}
}

// bagl/src/providers/cohere.ts — host Cohere embeddings + rerank (same Embedder/Ranker shape as Voyage/OpenAI).
// BAML defines Embedder/VectorStore/Ranker interfaces; this host implements them
// via fetch to api.cohere.com/v1 (no BAGL dep on a provider SDK).

import { fetchWithRetry } from "./http.js";

export class CohereEmbedder {
	constructor(
		public apiKey: string = process.env.COHERE_API_KEY ?? "",
		public model: "embed-english-v3.0" | "embed-multilingual-v3.0" = "embed-english-v3.0",
		public inputType: "search_query" | "search_document" = "search_document",
	) {}
	dim(): number {
		return 1024;
	}
	async embed(texts: string[]): Promise<number[][]> {
		if (!this.apiKey) throw new Error("COHERE_API_KEY missing for CohereEmbedder");
		const res = await fetchWithRetry("cohere embed", "https://api.cohere.com/v1/embed", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ texts, model: this.model, input_type: this.inputType, embedding_types: ["float"] }),
		});
		if (!res.ok) throw new Error(`Cohere embed ${res.status}: ${await res.text()}`);
		const j = (await res.json()) as { embeddings: { float: number[][] } };
		return j.embeddings.float;
	}
}

export class CohereRanker {
	constructor(
		public apiKey: string = process.env.COHERE_API_KEY ?? "",
		public model: "rerank-english-v3.0" | "rerank-multilingual-v3.0" = "rerank-english-v3.0",
	) {}
	async rank(query: string, documents: string[], topN?: number): Promise<{ index: number; relevance_score: number }[]> {
		if (!this.apiKey) throw new Error("COHERE_API_KEY missing for CohereRanker");
		const body: any = { model: this.model, query, documents };
		if (topN) body.top_n = topN;
		const res = await fetchWithRetry("cohere rerank", "https://api.cohere.com/v1/rerank", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`Cohere rerank ${res.status}: ${await res.text()}`);
		const j = (await res.json()) as { results: { index: number; relevance_score: number }[] };
		return j.results;
	}
}

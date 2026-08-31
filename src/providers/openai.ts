// bagl/src/providers/openai.ts — host OpenAI embeddings (same Embedder shape as Voyage).

export class OpenAIEmbedder {
	constructor(
		public apiKey: string = process.env.OPENAI_API_KEY ?? "",
		public model: "text-embedding-3-large" | "text-embedding-3-small" = "text-embedding-3-small",
		public dimensions?: number,
	) {}
	dim(): number {
		return this.dimensions ?? (this.model === "text-embedding-3-large" ? 3072 : 1536);
	}
	async embed(texts: string[]): Promise<number[][]> {
		if (!this.apiKey) throw new Error("OPENAI_API_KEY missing for OpenAIEmbedder");
		const body: any = { input: texts, model: this.model };
		if (this.dimensions) body.dimensions = this.dimensions;
		const res = await fetch("https://api.openai.com/v1/embeddings", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`OpenAI embed ${res.status}: ${await res.text()}`);
		const j = (await res.json()) as { data: { embedding: number[] }[] };
		return j.data.map((d) => d.embedding);
	}
}

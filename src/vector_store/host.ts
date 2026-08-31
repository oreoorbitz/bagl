// bagl/src/vector_store/host.ts — HostVectorStore: inject any driver without BAGL depending on `pg`.
// BAML owns VectorStore {upsert, search, count}; host implements it via callbacks.
// Example: new HostVectorStore({ upsert: (cs)=> pg.query(...), search: (q,k)=> pg.query(...) })

import type { Chunk, RetrievedDoc } from "../../baml_sdk/index.js";

export type VectorStoreHost = {
	upsert(chunks: Chunk[]): Promise<void> | void;
	search(queryEmbedding: number[], k: number): Promise<RetrievedDoc[]> | RetrievedDoc[];
	count(): Promise<number> | number;
};

export class HostVectorStore {
	constructor(private host: VectorStoreHost) {}
	async upsert(chunks: Chunk[]): Promise<void> {
		await this.host.upsert(chunks);
	}
	async search(queryEmbedding: number[], k: number): Promise<RetrievedDoc[]> {
		return await this.host.search(queryEmbedding, k);
	}
	async count(): Promise<number> {
		return await this.host.count();
	}
	// BAML dispatch shape — so BAML can call `store.search(q,k)` when `store` is a HostVectorStore
	// passed as `VectorStore` value (interface dispatch via bridge).
}

// In-memory host fallback (same as BAML InMemoryVectorStore, but host-owned for demos)
export class InMemoryHostStore implements VectorStoreHost {
	private store: Chunk[] = [];
	async upsert(chunks: Chunk[]): Promise<void> {
		this.store.push(...chunks);
	}
	async search(queryEmbedding: number[], k: number): Promise<RetrievedDoc[]> {
		const scored = this.store.map((ch) => {
			const emb = (ch as any).embedding as number[] | undefined;
			let dot = 0;
			if (emb && emb.length === queryEmbedding.length) {
				for (let i = 0; i < emb.length; i++) dot += emb[i] * queryEmbedding[i];
			}
			return { chunk: ch, score: dot } as RetrievedDoc;
		});
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, k);
	}
	async count(): Promise<number> {
		return this.store.length;
	}
}

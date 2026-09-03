// bagl/src/store.ts — file-backed chunk store for the CLI (.bagl/store.json).
// BAML owns chunking/embedding/retrieval (ingest/retrieve fns); this file
// owns persistence only. RagContext carries the embedder handle and is not
// serializable, so the store keeps plain chunks+vectors and each command
// rebuilds the context with a matching-dim NaiveEmbedder.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StoredChunk = { doc_id: string; chunk_id: string; text: string; embedding: number[] };
export type StoredDoc = { id: string; text: string; metadata: Record<string, string> };
export type BaglStore = {
	version: 1;
	dim: number;
	chunk_size: number;
	overlap: number;
	docs: StoredDoc[];
	chunks: StoredChunk[];
};

export const BAGL_DIM = 8;

export function storePath(cwd: string = process.cwd()): string {
	return join(cwd, ".bagl", "store.json");
}

export function loadStore(cwd: string = process.cwd()): BaglStore | null {
	const fp = storePath(cwd);
	if (!existsSync(fp)) return null;
	try {
		const s = JSON.parse(readFileSync(fp, "utf8")) as BaglStore;
		if (s.version !== 1 || !Array.isArray(s.chunks)) return null;
		return s;
	} catch {
		return null;
	}
}

export function saveStore(store: BaglStore, cwd: string = process.cwd()): string {
	const fp = storePath(cwd);
	mkdirSync(join(cwd, ".bagl"), { recursive: true });
	writeFileSync(fp, JSON.stringify(store, null, 2));
	return fp;
}

// Upsert a document's chunks: same doc id replaces its prior chunks.
export function upsertDoc(store: BaglStore, doc: StoredDoc, chunks: StoredChunk[]): BaglStore {
	return {
		...store,
		docs: [...store.docs.filter((d) => d.id !== doc.id), doc],
		chunks: [...store.chunks.filter((c) => c.doc_id !== doc.id), ...chunks],
	};
}

export function emptyStore(chunk_size: number, overlap: number): BaglStore {
	return { version: 1, dim: BAGL_DIM, chunk_size, overlap, docs: [], chunks: [] };
}

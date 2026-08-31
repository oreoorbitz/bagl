#!/usr/bin/env node
// bagl — extensible RAG orchestrator CLI (sibling to bi).

import { ingest, retrieve, RagAnswer, AnswerQuestion, NaiveChunker, NaiveEmbedder, HostRetriever, type Document } from "../baml_sdk/index.js";
import { listBaisIssues, readyBaisIssues } from "./bais.js";

function printHelp(): void {
	console.log(`bagl — extensible RAG orchestrator (BAML)

Usage:
  bagl ingest <file> [--chunk-size 300] [--overlap 50]
  bagl retrieve <query> [--k 3]
  bagl ask <question> [--k 3]
  bagl bais list [--json]
  bagl bais ready [--json]

Notes: ingest/retrieve/ask use the in-VM naive chunker/embedder (offline, no API key).
For LLM generation, set OPENAI_API_KEY. This skeleton surfaces BAML chunk/embed/retrieve
as interfaces you can replace with a host retriever (vector DB, etc.).
BAIS: bais list/ready reads .bais/issues/*.toml via bais BAML parser (BAML is validator).
`);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const cmd = args[0];
	if (!cmd || args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(cmd ? 0 : 1);
	}
	// Demo in-memory store for the CLI session — real impl would use a vector DB.
	// Keep it tiny: one hardcoded doc.
	const demoDocs: Document[] = [new (await import("../baml_sdk/index.js")).Document({ id: "demo", text: "BAML is a language for LLM workflows. BAGL is a RAG orchestrator built in BAML.", metadata: {} })];

	if (cmd === "ask") {
		const q = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
		if (!q) { console.error("ask requires <question>"); process.exit(1); }
		const k = Number(args.find((a, i) => args[i - 1] === "--k") ?? "3");
		const chunker = new NaiveChunker({ chunk_size: 200, overlap: 20 });
		const embedder = new NaiveEmbedder({ dim_val: 8 });
		const ctx = await ingest(demoDocs, chunker, embedder);
		const answer = await RagAnswer(q, ctx, { k });
		console.log(JSON.stringify(answer, null, 2));
		return;
	}

	if (cmd === "bais") {
		const sub = args[1];
		const asJson = args.includes("--json");
		if (sub === "list") {
			const files = await listBaisIssues();
			if (asJson) console.log(JSON.stringify(files, null, 2));
			else {
				for (const f of files) console.log(`${f.issue.id}\t${f.issue.status}\t${f.issue.kind}\t${f.issue.title}`);
				if (files.length === 0) console.error("(no .bais/issues/*.toml — run bais init or add issues)");
			}
			return;
		}
		if (sub === "ready") {
			const files = await readyBaisIssues();
			if (asJson) console.log(JSON.stringify(files, null, 2));
			else {
				for (const f of files) console.log(`${f.issue.id}\t${f.issue.title}`);
				if (files.length === 0) console.log("(no ready issues)");
			}
			return;
		}
		console.error(`Unknown bais subcommand: ${sub ?? ""} (try: bais list | bais ready)`);
		printHelp();
		process.exit(1);
	}

	printHelp();
	process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

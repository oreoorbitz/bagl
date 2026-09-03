#!/usr/bin/env node
// bagl — extensible RAG orchestrator CLI (sibling to bi).

import { ingest_docs, retrieve_chunks, AnswerQuestion, Chunk, Document } from "../baml_sdk/index.js";
// NOTE: ingest/retrieve/RagAnswer take interface handles (Chunker/Embedder)
// that do not round-trip from the host (cf. bi proposals 04) — the CLI uses
// the plain-data boundary fns ingest_docs/retrieve_chunks + AnswerQuestion.
import { loadBaisIssues, readyBaisIssues, filterReadyIssues, createBaisIssue, moveBaisIssue, checkBaisIssues, graphBaisIssues } from "./bais.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { BAGL_DIM, emptyStore, loadStore, saveStore, upsertDoc, type BaglStore } from "./store.js";

function printHelp(): void {
	console.log(`bagl — extensible RAG orchestrator (BAML) — .bais is first-class

Usage:
  bagl                              # default: show ready BAIS issues
  bagl ingest <file> [--chunk-size 300] [--overlap 50]
  bagl ingest --bais [--ready] [--status <S>]   # RAG over .bais/issues, completeness loud
  bagl retrieve <query> [--k 3]
  bagl ask <question> [--k 3]
  bagl bais list [--json]
  bagl bais ready [--json]
  bagl bais new "title" --kind <Kind> [--area <area>] [--status <Status>] [--body <md>]
  bagl bais move <id> <Status>
  bagl bais check [--json]
  bagl bais graph --from <id> [--json]

Notes: ingest/retrieve/ask use the in-VM naive chunker/embedder (offline, no API key).
For LLM generation, set OPENAI_API_KEY. This skeleton surfaces BAML chunk/embed/retrieve
as interfaces you can replace with a host retriever (vector DB, etc.).
BAIS: .bais is first-class — bais new/move/check/graph via BAML validator; default shows ready.
`);
}

function getFlag(args: string[], name: string): string | undefined {
	const idx = args.indexOf(name);
	if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
	if (name.startsWith("--")) {
		const eq = args.find((a) => a.startsWith(`${name}=`));
		if (eq) return eq.slice(name.length + 1);
	}
	return undefined;
}

function hasFlag(args: string[], name: string): boolean {
	return args.includes(name);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const cmd = args[0];
	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(0);
	}
	if (!cmd) {
		const ready = await readyBaisIssues();
		if (ready.length === 0) console.log("(no ready BAIS issues — `bagl bais list` to see all)");
		else for (const f of ready) console.log(`${f.issue.id}\t${f.issue.status}\t${f.issue.kind}\t${f.issue.title}`);
		console.log("\n`bagl --help` for commands, `bagl bais new \"title\"` to add");
		process.exit(0);
	}
	// Load stored chunks as plain data (Chunk is a concrete class — no
	// interface handle crosses, so this round-trips fine).
	function loadChunksOrExit(): { chunks: Chunk[]; dim: number } {
		const store = loadStore();
		if (!store || store.chunks.length === 0) {
			console.error("empty store — `bagl ingest <file>` first");
			process.exit(1);
		}
		const s: BaglStore = store;
		// Bridge workaround (proposals/12): integer-valued JS numbers do
		// not encode as float in typed list args, and naive vectors are
		// all whole numbers. Nudge by 1e-9 at the crossing only — the
		// store keeps exact values, ranking is unaffected.
		const crossing = (v: number[]) => v.map((x) => (Number.isInteger(x) ? x + 1e-9 : x));
		return {
			chunks: s.chunks.map((c) => new Chunk({ doc_id: c.doc_id, chunk_id: c.chunk_id, text: c.text, embedding: crossing(c.embedding) })),
			dim: s.dim,
		};
	}

	// Shared single-doc ingest: chunk+embed in-VM, upsert plain chunks.
	async function ingestOneDoc(id: string, text: string, chunkSize: number, overlap: number): Promise<number> {
		const ctx = await ingest_docs([new Document({ id, text, metadata: {} })], chunkSize, overlap, BAGL_DIM);
		const prev = loadStore() ?? emptyStore(chunkSize, overlap);
		if (prev.chunks.length > 0 && (prev.chunk_size !== chunkSize || prev.overlap !== overlap)) {
			console.error(`[bagl] chunk params differ from store (${prev.chunk_size}/${prev.overlap}) — new chunks use ${chunkSize}/${overlap}`);
		}
		const next = upsertDoc(prev, { id, text, metadata: {} }, ctx.chunks.map((c) => ({ doc_id: c.doc_id, chunk_id: c.chunk_id, text: c.text, embedding: [...(c.embedding ?? [])] })));
		saveStore(next);
		return ctx.chunks.length;
	}

	if (cmd === "ingest") {
		const chunkSize = Number(getFlag(args, "--chunk-size") ?? "300");
		const overlap = Number(getFlag(args, "--overlap") ?? "50");
		// RAG over the issue tracker: one doc per issue, completeness loud.
		if (hasFlag(args, "--bais")) {
			const { ok, bad, dangling, cycles } = await checkBaisIssues();
			let files = ok;
			if (hasFlag(args, "--ready")) files = filterReadyIssues(ok);
			const statusF = getFlag(args, "--status");
			if (statusF) files = files.filter((f) => f.issue.status === statusF);
			let total = 0;
			for (const f of files) {
				const edges = f.edges.map((e) => `${e.kind}: ${e.to}`).join("\n");
				const text = `# ${f.issue.id} ${f.issue.title}\nstatus: ${f.issue.status} | kind: ${f.issue.kind}${f.issue.area ? ` | area: ${f.issue.area}` : ""}\n${edges}\n\n${f.issue.body}`;
				total += await ingestOneDoc(f.issue.id, text, chunkSize, overlap);
			}
			const missing = dangling.filter((d) => d.status === "Missing").length;
			console.log(`ingested ${files.length} issues: ${total} chunks`);
			// Completeness (cf. BAIS as_of/completeness): a short ingest is
			// never silent — unparseable files, dangling refs, and cycles
			// are reported, never folded into the chunk count.
			console.error(`[bagl] completeness: ${files.length} ingested, ${bad.length} unparseable excluded${bad.length ? ` (${bad.map((b) => b.file).join(", ")})` : ""}, ${missing} missing refs, ${cycles.length} cycles`);
			if (bad.length || missing || cycles.length) process.exitCode = 1;
			return;
		}
		const file = args[1];
		if (!file || file.startsWith("--")) { console.error("ingest requires <file> [--bais]"); process.exit(1); }
		const id = getFlag(args, "--id") ?? basename(file);
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			console.error(`cannot read ${file}`);
			process.exit(1);
		}
		// Chunk+embed inside the VM (BAML owns the pipeline, impls built
		// in-VM via ingest_docs); persist the plain chunks+vectors.
		const n = await ingestOneDoc(id, text, chunkSize, overlap);
		console.log(`ingested ${id}: ${n} chunks`);
		return;
	}

	if (cmd === "retrieve") {
		const q = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
		if (!q) { console.error("retrieve requires <query>"); process.exit(1); }
		const k = Number(getFlag(args, "--k") ?? "3");
		const { chunks, dim } = loadChunksOrExit();
		const hits = await retrieve_chunks(q, chunks, dim, k);
		if (args.includes("--json")) {
			console.log(JSON.stringify(hits.map((h) => ({ chunk_id: h.chunk.chunk_id, doc_id: h.chunk.doc_id, score: h.score, text: h.chunk.text })), null, 2));
		} else {
			for (const h of hits) console.log(`${h.score.toFixed(4)}\t${h.chunk.chunk_id}\t${h.chunk.text.slice(0, 120)}`);
		}
		return;
	}

	if (cmd === "ask") {
		const q = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
		if (!q) { console.error("ask requires <question>"); process.exit(1); }
		if (!process.env.OPENAI_API_KEY) {
			console.error("ask needs OPENAI_API_KEY for generation (retrieve is offline)");
			process.exit(1);
		}
		const k = Number(args.find((a, i) => args[i - 1] === "--k") ?? "3");
		const { chunks, dim } = loadChunksOrExit();
		const hits = await retrieve_chunks(q, chunks, dim, k);
		const answer = await AnswerQuestion(q, hits.map((h) => h.chunk.text));
		console.log(JSON.stringify(answer, null, 2));
		return;
	}

	if (cmd === "bais") {
		const sub = args[1];
		const asJson = args.includes("--json");
		if (sub === "list") {
			const { issues: files, failures } = await loadBaisIssues();
			if (asJson) console.log(JSON.stringify({ issues: files, unparseable: failures }, null, 2));
			else {
				for (const f of files) console.log(`${f.issue.id}\t${f.issue.status}\t${f.issue.kind}\t${f.issue.title}`);
				for (const b of failures) console.log(`bad\t${b.file}\t${b.error}`);
				if (files.length === 0 && failures.length === 0) console.error("(no .bais/issues/*.toml — run bais init or add issues)");
			}
			return;
		}
		if (sub === "ready") {
			// JSON shape matches `bais ready --json`: {ready, unparseable}.
			const { issues, failures } = await loadBaisIssues();
			const ready = filterReadyIssues(issues);
			if (asJson) console.log(JSON.stringify({ ready, unparseable: failures }, null, 2));
			else {
				for (const f of ready) console.log(`${f.issue.id}\t${f.issue.title}`);
				if (ready.length === 0) console.log("(no ready issues)");
				if (failures.length) console.error(`[bais] ${failures.length} unparseable file(s) excluded — \`bagl bais check\` for details`);
			}
			return;
		}
		if (sub === "new") {
			const title = args[2];
			if (!title) { console.error('bais new requires "title"'); process.exit(1); }
			const kind = getFlag(args, "--kind") ?? "Feat";
			const area = getFlag(args, "--area");
			const status = getFlag(args, "--status") ?? "Open";
			const body = getFlag(args, "--body");
			const file = await createBaisIssue({ title, kind, area, body, status });
			console.log(`${file.issue.id}\t${file.issue.title}`);
			return;
		}
		if (sub === "move") {
			const id = args[2];
			const status = args[3];
			if (!id || !status) { console.error("bais move requires <id> <Status>"); process.exit(1); }
			const file = await moveBaisIssue(id, status);
			console.log(`${file.issue.id}\t${file.issue.status}`);
			return;
		}
		if (sub === "check") {
			const { ok, bad, dangling, cycles } = await checkBaisIssues();
			const missing = dangling.filter((d) => d.status === "Missing");
			const external = dangling.filter((d) => d.status === "External");
			if (asJson) console.log(JSON.stringify({ ok: ok.length, bad, dangling, cycles }, null, 2));
			else {
				for (const f of ok) console.log(`ok\t${f.issue.id}`);
				for (const b of bad) console.log(`bad\t${b.file}\t${b.error}`);
				// A Blocks edge naming an id that does not exist parks its target
				// indefinitely — is_blocked treats an unresolvable blocker as
				// blocking — so a missing reference is a defect, not a warning.
				for (const d of missing) console.log(`dangling\t${d.declaredBy}\t${d.side}=${d.id}\t${d.kind} ${d.from} -> ${d.to}`);
				// Another project's id is not resolvable from here. Reported so a
				// typo'd prefix stays visible, but not a failure.
				for (const d of external) console.log(`external\t${d.declaredBy}\t${d.side}=${d.id}\t${d.kind} ${d.from} -> ${d.to}`);
				// Nothing in a dependency cycle can ever become ready — and
				// ready_issues reports that as silence. cycles is the diagnosis.
				if (cycles.length) console.log(`cycle\t${cycles.join(", ")}`);
			}
			// Applies to both output modes — --json previously always exited 0,
			// which made it useless as a CI gate. External alone never fails.
			if (bad.length || missing.length || cycles.length) process.exit(1);
			return;
		}
		if (sub === "graph") {
			const from = getFlag(args, "--from");
			if (!from) { console.error("bais graph requires --from <id>"); process.exit(1); }
			const files = await graphBaisIssues(from);
			if (asJson) console.log(JSON.stringify(files, null, 2));
			else for (const f of files) console.log(`${f.issue.id}\t${f.issue.title}\t[${f.edges.map((e) => e.kind).join(",")}]`);
			return;
		}
		console.error(`Unknown bais subcommand: ${sub ?? ""} (try: bais list | ready | new | move | check | graph)`);
		printHelp();
		process.exit(1);
	}

	printHelp();
	process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

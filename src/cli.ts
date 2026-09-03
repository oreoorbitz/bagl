#!/usr/bin/env node
// bagl — extensible RAG orchestrator CLI (sibling to bi).

import { ingest, retrieve, RagAnswer, AnswerQuestion, NaiveChunker, NaiveEmbedder, HostRetriever, type Document } from "../baml_sdk/index.js";
import { loadBaisIssues, readyBaisIssues, filterReadyIssues, createBaisIssue, moveBaisIssue, checkBaisIssues, graphBaisIssues } from "./bais.js";

function printHelp(): void {
	console.log(`bagl — extensible RAG orchestrator (BAML) — .bais is first-class

Usage:
  bagl                              # default: show ready BAIS issues
  bagl ingest <file> [--chunk-size 300] [--overlap 50]
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

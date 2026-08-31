// bagl/src/bais.ts — TS-level BAIS interop (mirrors bi/src/bais.ts).
// bais is the single source of truth for Issue/Edge (bais/baml_src/main.baml).
// Until `baml.toml [dependencies]` lands (Phase-B, single-workspace invariant),
// bagl consumes BAIS via the TS host: reads .bais/issues/*.toml and validates
// through bais's BAML parser (bais/src/toml.ts → bais/baml_src/ns_toml/toml.baml),
// keeping BAML as validator without a BAML-level import.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type BaisIssue = {
	id: string;
	title: string;
	status: string;
	kind: string;
	area: string | null;
	severity: number | null;
	source: string | null;
	body: string;
};

export type BaisEdge = { from: string; to: string; kind: string };
export type BaisFile = { issue: BaisIssue; edges: BaisEdge[] };

function resolveIssuesDir(from: string = process.cwd()): string | null {
	const candidates = [
		join(from, ".bais", "issues"),
		join(from, "bais", ".bais", "issues"),
		resolve(from, "../bais/.bais/issues"),
		join(resolve(from, ".."), ".bais", "issues"),
		resolve(from, "../bais"),
	];
	for (const c of candidates) {
		if (existsSync(c)) return c;
		const alt = join(c, "bais", ".bais", "issues");
		if (existsSync(alt)) return alt;
	}
	const sibling = resolve(from, "../bais/.bais/issues");
	if (existsSync(sibling)) return sibling;
	const here = join(from, "bais", ".bais", "issues");
	if (existsSync(here)) return here;
	return null;
}

async function validateViaBaisBaml(text: string): Promise<BaisFile> {
	const { pathToFileURL } = await import("node:url");
	const candidates = [
		join(resolve(process.cwd(), "../bais"), "dist", "src", "toml.js"),
		join(resolve(process.cwd(), "../bais"), "src", "toml.ts"),
		join(resolve(process.cwd(), "../../bais"), "dist", "src", "toml.js"),
		resolve(join(resolve(process.cwd(), "bais"), "dist", "src", "toml.js")),
		resolve(join(resolve(process.cwd(), "..", "bais"), "dist", "src", "toml.js")),
	];
	for (const p of candidates) {
		if (!existsSync(p)) continue;
		try {
			const url = pathToFileURL(p).href;
			const mod = await (Function("u", "return import(u)") as any)(url);
			if (mod?.parseBaisFile) return (await mod.parseBaisFile(text)) as BaisFile;
		} catch {}
	}
	try {
		const spec = "../../../bais/dist/src/toml.js";
		const mod = await (Function("s", "return import(s)") as any)(spec);
		if (mod?.parseBaisFile) return (await mod.parseBaisFile(text)) as BaisFile;
	} catch {}
	throw new Error(`BAIS parser not found — tried ${candidates.join(", ")}`);
}

export async function listBaisIssues(dir?: string): Promise<BaisFile[]> {
	const issuesDir = dir ?? resolveIssuesDir() ?? resolve(process.cwd(), "../bais/.bais/issues");
	if (!existsSync(issuesDir)) return [];
	const files = readdirSync(issuesDir).filter((f) => f.endsWith(".toml"));
	const out: BaisFile[] = [];
	for (const f of files) {
		const text = readFileSync(join(issuesDir, f), "utf8");
		try {
			const parsed = await validateViaBaisBaml(text);
			out.push(parsed);
		} catch {
			const id = f.replace(/\.toml$/, "");
			out.push({
				issue: { id, title: f, status: "Open", kind: "Proposal", area: null, severity: null, source: null, body: text },
				edges: [],
			});
		}
	}
	return out;
}

export async function readyBaisIssues(dir?: string): Promise<BaisFile[]> {
	const all = await listBaisIssues(dir);
	const issues = all.map((f) => f.issue);
	const edges = all.flatMap((f) => f.edges);
	const blocked = new Set<string>();
	for (const e of edges) {
		if (e.kind === "Blocks") {
			const blocker = issues.find((i) => i.id === e.from);
			if (blocker && blocker.status !== "Done" && blocker.status !== "Dropped") blocked.add(e.to);
		}
	}
	return all.filter((f) => f.issue.status === "Open" && !blocked.has(f.issue.id));
}

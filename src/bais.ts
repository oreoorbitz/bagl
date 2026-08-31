// bagl/src/bais.ts — TS-level BAIS interop (mirrors bi/src/bais.ts).
// bais is the single source of truth for Issue/Edge (bais/baml_src/main.baml).
// Until `baml.toml [dependencies]` lands (Phase-B, single-workspace invariant),
// bagl consumes BAIS via the TS host: reads .bais/issues/*.toml and validates
// through bais's BAML parser (bais/src/toml.ts → bais/baml_src/ns_toml/toml.baml),
// keeping BAML as validator without a BAML-level import.

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
		join(from, ".bais", "issues"), // cwd is bagl/
		join(from, "bagl", ".bais", "issues"), // cwd is orion-learn-baml/
		join(from, "bais", ".bais", "issues"),
		resolve(from, "../bais/.bais/issues"),
		join(resolve(from, ".."), ".bais", "issues"),
		resolve(from, "../bais"),
		join(from, ".bais"),
		join(from, "bagl", ".bais", "issues"),
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

function nextBaisId(dir: string, prefix = "bagl"): string {
	const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".toml")) : [];
	let max = 0;
	for (const f of files) {
		const m = f.match(/^.*#(\d+)\.toml$/);
		if (m) max = Math.max(max, parseInt(m[1], 10));
	}
	return `${prefix}#${String(max + 1).padStart(2, "0")}`;
}

async function serializeViaBaisBaml(file: BaisFile): Promise<string> {
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
			if (mod?.serializeBaisFile) return (await mod.serializeBaisFile(file)) as string;
		} catch {}
	}
	try {
		const spec = "../../../bais/dist/src/toml.js";
		const mod = await (Function("s", "return import(s)") as any)(spec);
		if (mod?.serializeBaisFile) return (await mod.serializeBaisFile(file)) as string;
	} catch {}
	const i = file.issue;
	let out = `id = "${i.id}"\ntitle = "${i.title.replace(/"/g, '\\"')}"\nstatus = "${i.status}"\nkind = "${i.kind}"\n`;
	if (i.area) out += `area = "${i.area}"\n`;
	if (i.severity != null) out += `severity = ${i.severity}\n`;
	if (i.source) out += `source = "${i.source}"\n`;
	out += `body = """\n${i.body}\n"""\n`;
	for (const e of file.edges) out += `\n[[edge]]\nfrom = "${e.from}"\nto = "${e.to}"\nkind = "${e.kind}"\n`;
	return out;
}

export async function createBaisIssue(opts: {
	title: string;
	kind?: string;
	area?: string;
	body?: string;
	status?: string;
	dir?: string;
}): Promise<BaisFile> {
	const dir = opts.dir ?? resolveIssuesDir() ?? join(process.cwd(), "bagl", ".bais", "issues");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const issuesDir = existsSync(dir) ? dir : join(process.cwd(), "bagl/.bais/issues");
	if (!existsSync(issuesDir)) mkdirSync(issuesDir, { recursive: true });
	const targetDir = existsSync(dir) ? dir : issuesDir;
	const id = nextBaisId(targetDir, "bagl");
	const file: BaisFile = {
		issue: {
			id,
			title: opts.title,
			status: opts.status ?? "Open",
			kind: opts.kind ?? "Feat",
			area: opts.area ?? null,
			severity: null,
			source: null,
			body: opts.body ?? `Seeded via \`bagl bais new\` for ${id}.`,
		},
		edges: [],
	};
	const toml = await serializeViaBaisBaml(file);
	await validateViaBaisBaml(toml);
	writeFileSync(join(targetDir, `${id}.toml`), toml);
	return file;
}

export async function moveBaisIssue(id: string, status: string, dir?: string): Promise<BaisFile> {
	const issuesDir = dir ?? resolveIssuesDir() ?? join(process.cwd(), "bagl/.bais/issues");
	if (!existsSync(issuesDir)) throw new Error(`No .bais/issues at ${issuesDir}`);
	const fp = join(issuesDir, `${id}.toml`);
	if (!existsSync(fp)) throw new Error(`No issue ${id} at ${fp}`);
	const text = readFileSync(fp, "utf8");
	const file = await validateViaBaisBaml(text);
	(file as any).issue.status = status;
	const toml = await serializeViaBaisBaml(file);
	await validateViaBaisBaml(toml);
	writeFileSync(fp, toml);
	return file;
}

export async function checkBaisIssues(dir?: string): Promise<{ ok: BaisFile[]; bad: { file: string; error: string }[] }> {
	const issuesDir = dir ?? resolveIssuesDir() ?? join(process.cwd(), "bagl/.bais/issues");
	if (!existsSync(issuesDir)) return { ok: [], bad: [] };
	const files = readdirSync(issuesDir).filter((f) => f.endsWith(".toml"));
	const ok: BaisFile[] = [];
	const bad: { file: string; error: string }[] = [];
	for (const f of files) {
		const text = readFileSync(join(issuesDir, f), "utf8");
		try {
			ok.push(await validateViaBaisBaml(text));
		} catch (e: any) {
			bad.push({ file: f, error: String(e?.message ?? e) });
		}
	}
	return { ok, bad };
}

export async function graphBaisIssues(fromId: string, dir?: string): Promise<BaisFile[]> {
	const all = await listBaisIssues(dir);
	const edges = all.flatMap((f) => f.edges);
	const seen = new Set<string>([fromId]);
	const queue = [fromId];
	while (queue.length) {
		const cur = queue.shift()!;
		for (const e of edges) {
			if (e.from === cur && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
			if (e.to === cur && !seen.has(e.from)) { seen.add(e.from); queue.push(e.from); }
		}
	}
	return all.filter((f) => seen.has(f.issue.id));
}

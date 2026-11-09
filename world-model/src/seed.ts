import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";
import { Service } from "./service.ts";
import { ingestSource } from "./extract.ts";
import { guessType, slackToText } from "./parse.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "sources");
/** Source files in ingestion order, with how many days ago each was written (so freshness checks have something to show). */
export const DEMO_SOURCES = [
  { file: "product-brief-pm-context.md", daysAgo: 70 }, { file: "prd-brief-studio.md", daysAgo: 20 },
  { file: "slack-pm-writing.json", daysAgo: 9 }, { file: "research-pm-writing-summary.md", daysAgo: 25 },
  { file: "granola-excerpts.md", daysAgo: 12 }, { file: "zoom-ai-excerpts.md", daysAgo: 14 },
];

export async function seedDemo(svc: Service, opts: { leaveLastPending?: boolean } = {}) {
  const prev = process.env.WM_OFFLINE;
  process.env.WM_OFFLINE = "1"; // deterministic: use the curated extractions
  try { return await seedInner(svc, opts); } finally { if (prev === undefined) delete process.env.WM_OFFLINE; else process.env.WM_OFFLINE = prev; }
}

async function seedInner(svc: Service, opts: { leaveLastPending?: boolean }) {
  const { id } = svc.createModel("PM artifacts: PRDs, product briefs and other written PM artifacts");
  for (const [i, s] of DEMO_SOURCES.entries()) {
    const raw = readFileSync(join(SRC, s.file), "utf8");
    const guess = guessType(s.file);
    const text = s.file.endsWith(".json") ? slackToText(raw).text : raw;
    const date = new Date(Date.now() - s.daysAgo * 86400000).toISOString();
    const src = svc.addSource(id, { ...guess, filename: s.file, text, source_date: date });
    const r = await ingestSource(svc, src.id);
    if (opts.leaveLastPending && i === DEMO_SOURCES.length - 1) continue;
    const ids = svc.listProposals(id, "pending").filter((p) => p.batch_id === r.batch_id).map((p) => p.id);
    svc.approve(ids, "seed", {}, "Demo seed: reviewed and accepted");
  }
  return id;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const svc = new Service(openDb());
  const id = await seedDemo(svc, { leaveLastPending: process.argv.includes("--pending-last") });
  const m = svc.getModel(id);
  console.log(`Seeded model ${id}: ${m.nodes.length} nodes, ${m.edges.length} edges, version ${m.version}, coverage ${m.health.coverage.score}%`);
}

// A stand-in "external agent" that drives the demo loop over the REST API (no access to the database).
//   1. read the world model for its task  2. notice a research insight the model lacks  3. write it back as a proposal
// Run the server first (npm start), seed it (npm run seed), then: npm run demo:agent [-- --approve]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.WM_URL ?? "http://127.0.0.1:3737";
const ACTOR = "demo-prd-agent";
const TASK = "draft a PRD section for the success metrics of a new feature";
const H = { "content-type": "application/json", "x-actor": ACTOR, ...(process.env.WM_OWNER_TOKEN ? { authorization: `Bearer ${process.env.WM_OWNER_TOKEN}` } : {}) };
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(BASE + path, { headers: H, ...init });
  const body = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${body.error}`);
  return body;
};

const models = await api("/models");
if (!models.length) throw new Error("No models yet. Run: npm run seed");
const model = models[0];
console.log(`Task: ${TASK}\n`);

console.log("1. Reading the world model first...");
const ctx = await api(`/models/${model.id}/query?task=${encodeURIComponent(TASK)}`);
console.log(ctx.summary, "\n");
if (ctx.known_gaps.length) console.log("   Known gaps in this area:", ctx.known_gaps.map((g: any) => `${g.title} (${g.reason})`).join("; "), "\n");

console.log("2. Reading the raw research summary for anything the model does not know...");
const research = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "sources", "research-pm-writing-summary.md"), "utf8");
const full = await api(`/models/${model.id}`);
const known = (await Promise.all(full.nodes.map((n: any) => api(`/nodes/${n.id}`)))).flatMap((d: any) => d.evidence.map((e: any) => e.quote));
const insight = research.split("\n").map((l) => l.replace(/^\d+\.\s*/, "").trim()).find((l) => /meeting notes/i.test(l) && !known.includes(l));
// Ask the model itself where this insight belongs: the best-matching problem node.
const hit = insight ? await api(`/models/${model.id}/query?task=${encodeURIComponent(insight)}`) : null;
const target = hit?.matched.map((id: string) => full.nodes.find((n: any) => n.id === id)).find((n: any) => n?.type === "problem");
if (!insight || !target) { console.log("   Nothing new found. The model already has this insight."); process.exit(0); }
console.log(`   New insight: "${insight}"\n   Relates to: ${target.title}\n`);

console.log("3. Writing it back as a proposal (nothing changes until the owner approves)...");
const prop = await api(`/models/${model.id}/proposals`, {
  method: "POST",
  body: JSON.stringify({
    actor: ACTOR, actor_type: "agent", change_type: "add", rationale: `Found while drafting "${TASK}": quantifies how often PMs reshape AI meeting notes by hand.`,
    payload: { kind: "evidence", node_ids: [target.id], quote: insight, source: { type: "research", uri: "research-pm-writing-summary.md", label: "User research summary", date: new Date(Date.now() - 25 * 86400000).toISOString(), text: research } },
    source_ref: { uri: "research-pm-writing-summary.md", quote: insight },
  }),
});
console.log(`   Proposal ${prop.id} is ${prop.status}. Review it in the web app's Review queue.`);

if (process.argv.includes("--approve")) {
  const r = await api("/proposals/approve", { method: "POST", body: JSON.stringify({ ids: [prop.id], note: "Approved by demo script" }) });
  console.log(`4. Approved. Model is now at version ${r.version}. See the Changelog tab.`);
}

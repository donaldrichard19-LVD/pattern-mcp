import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { llmEnabled, structured } from "./llm.ts";
import { locateQuote, newId, Service, similarity, ValidationError } from "./service.ts";
import { EDGE_RULES, EDGE_TYPES, NODE_TYPES, type EdgeType, type NodeType, type SourceRow } from "./types.ts";

export interface RawNode { ref: string; type: NodeType; title: string; description?: string; status?: string; confidence?: string; quote?: string }
export interface RawEdge { from: string; to: string; type: EdgeType; quote?: string }
export interface RawEvidence { ref: string; quote: string; stance?: "supports" | "contradicts" }
export interface RawExtraction { nodes: RawNode[]; edges: RawEdge[]; evidence?: RawEvidence[] }

const HERE = dirname(fileURLToPath(import.meta.url));
const TYPES_FOR_LLM: NodeType[] = NODE_TYPES.filter((t): t is Exclude<NodeType, "product_area"> => t !== "product_area");

const TOOL = {
  name: "record_model",
  description: "Record the product world-model nodes, edges and evidence found in the document.",
  input_schema: {
    type: "object",
    properties: {
      nodes: { type: "array", items: { type: "object", properties: {
        ref: { type: "string", description: "Short local id, e.g. n1, or an existing node id to reuse" },
        type: { type: "string", enum: TYPES_FOR_LLM },
        title: { type: "string" }, description: { type: "string" },
        status: { type: "string", description: "features: shipped | in-flight | proposed" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        quote: { type: "string", description: "Verbatim passage (<=300 chars) from the document supporting this node" },
      }, required: ["ref", "type", "title", "quote"] } },
      edges: { type: "array", items: { type: "object", properties: {
        from: { type: "string" }, to: { type: "string" }, type: { type: "string", enum: [...EDGE_TYPES] },
      }, required: ["from", "to", "type"] } },
      evidence: { type: "array", description: "Extra verbatim quotes that support or contradict a node", items: { type: "object", properties: {
        ref: { type: "string" }, quote: { type: "string" }, stance: { type: "string", enum: ["supports", "contradicts"] },
      }, required: ["ref", "quote"] } },
    },
    required: ["nodes", "edges"],
  },
};

const SYSTEM = `You build a "product world model" from product documents. Extract a typed graph.
Node types: segment (who), outcome (what the user wants, phrased from their view), problem (obstacle to an outcome), feature (shipped|in-flight|proposed), metric (input/output metric, with value/target if stated), assumption (unknowns/open questions), decision (what/when/who/why).
Edges: segment -wants-> outcome; outcome -blocked_by-> problem; feature -addresses-> problem|outcome; feature -moves-> metric; decision|assumption -affects-> any.
Rules: every quote must be copied VERBATIM from the document. Prefer few, well-grounded nodes over many. Reuse existing node ids (given below) as refs instead of duplicating them. Never invent facts. Documents from research inputs (e.g. product reviews) are evidence about users and problems, not features to model.`;

/** Heuristic fallback for documents with explicit "Segment:/Outcome:/..." lines. */
export function taggedLineExtract(text: string): RawExtraction {
  const tags: Record<string, NodeType> = { segment: "segment", user: "segment", outcome: "outcome", problem: "problem", pain: "problem", feature: "feature", metric: "metric", assumption: "assumption", question: "assumption", decision: "decision" };
  const nodes: RawNode[] = [];
  text.split("\n").forEach((line, i) => {
    const m = /^\s*(?:[-*]\s*)?(?:\*\*)?(segment|user|outcome|problem|pain|feature|metric|assumption|question|decision)(?:\*\*)?\s*:\s*(.+?)\s*$/i.exec(line);
    if (m) nodes.push({ ref: `t${i}`, type: tags[m[1].toLowerCase()], title: m[2].replace(/\*\*/g, "").slice(0, 120), quote: line.trim() });
  });
  return { nodes, edges: [] };
}

function curatedFor(src: SourceRow): RawExtraction | null {
  if (!src.filename) return null;
  const p = join(HERE, "..", "demo", "extractions", src.filename.replace(/\.[^.]+$/, "") + ".json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

async function llmExtract(src: SourceRow, existing: { id: string; type: string; title: string }[]): Promise<RawExtraction> {
  const chunks: string[] = [];
  for (let i = 0; i < src.text.length; i += 12000) chunks.push(src.text.slice(i, i + 12000));
  const merged: RawExtraction = { nodes: [], edges: [], evidence: [] };
  for (const [ci, c] of chunks.entries()) {
    const r = await structured<RawExtraction>(SYSTEM,
      `Source type: ${src.type}${src.label ? ` (${src.label})` : ""}. Chunk ${ci + 1}/${chunks.length}.\nExisting nodes:\n${existing.map((n) => `${n.id} [${n.type}] ${n.title}`).join("\n") || "(none)"}\n\n--- DOCUMENT ---\n${c}`, TOOL);
    // Prefix refs per chunk so they cannot collide, but keep references to existing ids intact.
    const known = new Set(existing.map((n) => n.id)), fix = (r0: string) => (known.has(r0) ? r0 : `c${ci}_${r0}`);
    merged.nodes.push(...(r.nodes ?? []).map((n) => ({ ...n, ref: fix(n.ref) })));
    merged.edges.push(...(r.edges ?? []).map((e) => ({ ...e, from: fix(e.from), to: fix(e.to) })));
    merged.evidence!.push(...(r.evidence ?? []).map((e) => ({ ...e, ref: fix(e.ref) })));
  }
  return merged;
}

export async function extract(svc: Service, src: SourceRow): Promise<{ raw: RawExtraction; method: string }> {
  const curated = curatedFor(src);
  const existing = svc.db.prepare("SELECT id,type,title FROM nodes WHERE model_id=? AND type<>'product_area'").all(src.model_id) as any[];
  if (llmEnabled() && !process.env.WM_OFFLINE) return { raw: await llmExtract(src, existing), method: "llm" };
  if (curated) return { raw: curated, method: "curated-demo" };
  return { raw: taggedLineExtract(src.text), method: "tagged-lines" };
}

/** Turn a raw extraction into pending proposals (the review queue). Quotes that are not in the source are dropped. */
export async function ingestSource(svc: Service, sourceId: string, actor = "extractor", extractor: typeof extract = extract) {
  const src = svc.getSource(sourceId), modelId = src.model_id;
  const { raw, method } = await extractor(svc, src);
  const batch = newId("b"), g = svc.graph(modelId);
  const idFor = new Map<string, string>();      // raw ref -> real node id
  const newNodes = new Map<string, any>();      // node id -> add payload
  const merged: string[] = [], skipped: string[] = [];
  const evFor = (quote: string | undefined, stance: string = "supports") => {
    if (!quote?.trim()) return null;
    return locateQuote(src.text, quote)
      ? { quote: quote.trim(), source_id: src.id, source_date: src.source_date, source_type: src.type, stance }
      : null;
  };
  const extraEvidence: { id: string; ev: any }[] = [];

  for (const n of raw.nodes ?? []) {
    if (!TYPES_FOR_LLM.includes(n.type) || !n.title?.trim()) { skipped.push(`node ${n.ref}: bad type/title`); continue; }
    const dupe = g.nodes.find((x) => x.type === n.type && similarity(x.title, n.title) >= 0.75)
      ?? [...newNodes.entries()].map(([id, p]) => ({ id, ...p.node })).find((x) => x.type === n.type && similarity(x.title, n.title) >= 0.75);
    const ev = evFor(n.quote);
    if (dupe) {
      idFor.set(n.ref, dupe.id); merged.push(`${n.type} "${n.title}" → existing "${dupe.title}"`);
      if (ev) { const np = newNodes.get(dupe.id); if (np) np.evidence.push(ev); else extraEvidence.push({ id: dupe.id, ev }); }
      continue;
    }
    const id = newId("n"); idFor.set(n.ref, id);
    const conf = ev ? (n.confidence ?? "medium") : "low";
    newNodes.set(id, { kind: "node", node: { id, type: n.type, title: n.title.trim(), description: n.description ?? "", status: n.status, confidence: conf }, evidence: ev ? [ev] : [] });
  }
  for (const e of raw.evidence ?? []) {
    const id = idFor.get(e.ref) ?? (g.byId.has(e.ref) ? e.ref : null), ev = evFor(e.quote, e.stance);
    if (!id || !ev) { skipped.push(`evidence for ${e.ref}: unresolved ref or quote not in source`); continue; }
    const np = newNodes.get(id); if (np) np.evidence.push(ev); else extraEvidence.push({ id, ev });
  }

  const created: any[] = [];
  const mk = (change_type: string, payload: any, rationale: string, quote?: string) =>
    created.push(svc.createProposal(modelId, { actor, actor_type: "agent", change_type, payload, rationale, batch_id: batch, source_ref: { source_id: src.id, label: src.label || src.filename, quote } }));
  for (const [, p] of newNodes) mk("add", p, `Extracted from ${src.label || src.filename || src.type} (${method})`, p.evidence[0]?.quote);
  for (const { id, ev } of extraEvidence) mk("add", { kind: "evidence", node_ids: [id], quote: ev.quote, stance: ev.stance, source_id: src.id }, `Additional evidence from ${src.label || src.filename || src.type}`, ev.quote);
  const seen = new Set<string>();
  for (const e of raw.edges ?? []) {
    const from = idFor.get(e.from) ?? (g.byId.has(e.from) ? e.from : null), to = idFor.get(e.to) ?? (g.byId.has(e.to) ? e.to : null);
    const key = `${from}|${to}|${e.type}`;
    if (!from || !to || seen.has(key)) { skipped.push(`edge ${e.from}→${e.to}: unresolved or duplicate`); continue; }
    seen.add(key);
    const a = newNodes.get(from)?.node.type ?? g.byId.get(from)?.type, b = newNodes.get(to)?.node.type ?? g.byId.get(to)?.type, rule = EDGE_RULES[e.type];
    if (!rule || !rule.from.includes(a) || !rule.to.includes(b)) { skipped.push(`edge ${e.type} ${a}→${b} violates schema`); continue; }
    if (g.edges.some((x) => x.from_id === from && x.to_id === to && x.type === e.type)) { skipped.push(`edge ${e.type} already in model`); continue; }
    mk("link", { from_id: from, to_id: to, type: e.type }, `Relationship stated in ${src.label || src.filename || src.type}`, e.quote);
  }
  if (!created.length && !merged.length) throw new ValidationError("Extraction found nothing. Add an ANTHROPIC_API_KEY, or mark lines like 'Outcome: ...' for the offline extractor.");
  return { batch_id: batch, method, proposals: created.length, merged, skipped };
}

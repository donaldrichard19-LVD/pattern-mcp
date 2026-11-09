import { randomUUID } from "node:crypto";
import type { DB } from "./db.ts";
import { tx } from "./db.ts";
import {
  CHANGE_TYPES, EDGE_RULES, EDGE_TYPES, NODE_TYPES,
  type ChangelogEntry, type EdgeRow, type EdgeType, type EvidenceRow, type NodeRow, type NodeType,
  type ProposalRow, type SourceRow, type VersionRow,
} from "./types.ts";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const now = () => new Date().toISOString();
export const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const j = (v: unknown) => JSON.stringify(v ?? null);
const NODE_FIELDS = ["title", "description", "status", "owner", "confidence"] as const;

function node(r: any): NodeRow { return { ...r, flags: JSON.parse(r.flags) }; }
function evidenceRow(r: any): EvidenceRow { return { ...r, node_ids: JSON.parse(r.node_ids) }; }
function proposal(r: any): ProposalRow {
  return { ...r, payload: JSON.parse(r.payload), source_ref: JSON.parse(r.source_ref), conflicts: JSON.parse(r.conflicts) };
}

export function normTitle(s: string) { return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
const STOP = new Set("a an and are as at be but by for from has have in into is it its of on or that the their them they this to was were will with i we you our your not no so if then than can do does how what when which who why would should could about".split(" "));
export function tokens(s: string): string[] {
  return normTitle(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t)).map((t) => t.replace(/(ing|ed|es|s)$/, ""));
}
export function similarity(a: string, b: string) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface Graph { nodes: NodeRow[]; edges: EdgeRow[]; evidence: EvidenceRow[]; byId: Map<string, NodeRow> }

export class Service {
  constructor(public db: DB) {}

  // ---------- models & sources ----------
  createModel(name: string): { id: string } {
    if (!name?.trim()) throw new ValidationError("name is required");
    const id = newId("m"), t = now();
    tx(this.db, () => {
      this.db.prepare("INSERT INTO models(id,name,created_at,current_version) VALUES (?,?,?,0)").run(id, name.trim(), t);
      this.db.prepare(
        "INSERT INTO nodes(id,model_id,type,title,description,status,owner,confidence,flags,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)",
      ).run(newId("n"), id, "product_area", name.trim(), "", "active", "", "high", "[]", t, t);
      this.db.prepare("INSERT INTO versions(id,model_id,number,changelog,created_at) VALUES (?,?,?,?,?)").run(
        newId("v"), id, 0, j([{ proposal_id: null, actor: "system", actor_type: "human", at: t, change_type: "add", summary: `Created model "${name.trim()}"`, diff: { before: null, after: { name } } }]), t,
      );
    });
    return { id };
  }
  listModels() {
    return this.db.prepare("SELECT * FROM models ORDER BY created_at").all().map((m: any) => ({
      ...m,
      pending: (this.db.prepare("SELECT COUNT(*) c FROM proposals WHERE model_id=? AND status='pending'").get(m.id) as any).c,
    }));
  }
  model(id: string): any {
    const m = this.db.prepare("SELECT * FROM models WHERE id=?").get(id);
    if (!m) throw new NotFoundError(`model ${id} not found`);
    return m;
  }
  addSource(modelId: string, s: { type: string; label?: string; filename?: string; text: string; source_date?: string }): SourceRow {
    this.model(modelId);
    if (!s.text?.trim()) throw new ValidationError("source text is empty");
    const row: SourceRow = {
      id: newId("s"), model_id: modelId, type: s.type || "note", label: s.label ?? "", filename: s.filename ?? "",
      text: s.text, source_date: s.source_date ?? now(), ingested_at: now(),
    };
    this.db.prepare("INSERT INTO sources(id,model_id,type,label,filename,text,source_date,ingested_at) VALUES (?,?,?,?,?,?,?,?)").run(
      row.id, modelId, row.type, row.label, row.filename, row.text, row.source_date, row.ingested_at,
    );
    return row;
  }
  getSource(id: string): SourceRow {
    const s = this.db.prepare("SELECT * FROM sources WHERE id=?").get(id) as any;
    if (!s) throw new NotFoundError(`source ${id} not found`);
    return s;
  }
  listSources(modelId: string) {
    return this.db.prepare("SELECT id,type,label,filename,source_date,ingested_at,length(text) AS length FROM sources WHERE model_id=? ORDER BY ingested_at").all(modelId);
  }

  // ---------- graph reads ----------
  graph(modelId: string): Graph {
    this.model(modelId);
    const nodes = this.db.prepare("SELECT * FROM nodes WHERE model_id=? ORDER BY created_at, rowid").all(modelId).map(node);
    const edges = this.db.prepare("SELECT * FROM edges WHERE model_id=?").all(modelId) as unknown as EdgeRow[];
    const evidence = this.db.prepare("SELECT * FROM evidence WHERE model_id=? ORDER BY source_date DESC").all(modelId).map(evidenceRow);
    return { nodes, edges, evidence, byId: new Map(nodes.map((n) => [n.id, n])) };
  }
  getModel(modelId: string, staleDays = 30) {
    const m = this.model(modelId), g = this.graph(modelId);
    const evCount = new Map<string, number>();
    for (const e of g.evidence) for (const id of e.node_ids) evCount.set(id, (evCount.get(id) ?? 0) + 1);
    return {
      model: m, version: m.current_version,
      nodes: g.nodes.map((n) => ({ ...n, evidence_count: evCount.get(n.id) ?? 0 })),
      edges: g.edges, health: this.health(modelId, staleDays),
      pending_proposals: (this.db.prepare("SELECT COUNT(*) c FROM proposals WHERE model_id=? AND status='pending'").get(modelId) as any).c,
    };
  }
  getNode(nodeId: string) {
    const n = this.db.prepare("SELECT * FROM nodes WHERE id=?").get(nodeId);
    if (!n) throw new NotFoundError(`node ${nodeId} not found`);
    const nd = node(n), g = this.graph(nd.model_id);
    const evidence = g.evidence.filter((e) => e.node_ids.includes(nodeId)).map((e) => ({
      ...e, source: e.source_id ? this.db.prepare("SELECT id,type,label,filename,source_date FROM sources WHERE id=?").get(e.source_id) : null,
    }));
    const rel = (e: EdgeRow, otherId: string) => ({ edge: e, node: g.byId.get(otherId) });
    const history = this.changelog(nd.model_id).flatMap((v) => v.changelog.map((c) => ({ ...c, version: v.number })))
      .filter((c) => JSON.stringify(c.diff).includes(nodeId) || c.summary.includes(`"${nd.title}"`));
    return {
      node: nd, evidence,
      outgoing: g.edges.filter((e) => e.from_id === nodeId).map((e) => rel(e, e.to_id)),
      incoming: g.edges.filter((e) => e.to_id === nodeId).map((e) => rel(e, e.from_id)),
      history,
    };
  }
  changelog(modelId: string): VersionRow[] {
    return this.db.prepare("SELECT * FROM versions WHERE model_id=? ORDER BY number DESC").all(modelId).map((v: any) => ({ ...v, changelog: JSON.parse(v.changelog) }));
  }

  // ---------- proposals (write-back) ----------
  private knownNodes(modelId: string): Map<string, { type: NodeType; title: string }> {
    const m = new Map<string, { type: NodeType; title: string }>();
    for (const n of this.db.prepare("SELECT id,type,title FROM nodes WHERE model_id=?").all(modelId) as any[]) m.set(n.id, n);
    for (const p of this.listProposals(modelId, "pending")) {
      const nn = p.change_type === "add" && p.payload?.kind === "node" ? p.payload.node : null;
      if (nn?.id) m.set(nn.id, { type: nn.type, title: nn.title });
    }
    return m;
  }

  /** Validates payload shape and returns soft conflicts (duplicates, contradictions). */
  private validate(modelId: string, change: string, p: any): string[] {
    const known = this.knownNodes(modelId), conflicts: string[] = [];
    if (!p || typeof p !== "object") throw new ValidationError("payload must be an object");
    const need = (id: string) => { if (!known.has(id)) throw new ValidationError(`unknown node id ${id}`); return known.get(id)!; };
    if (change === "add") {
      if (p.kind === "node") {
        const n = p.node ?? {};
        if (!NODE_TYPES.includes(n.type) || n.type === "product_area") throw new ValidationError(`node.type must be one of ${NODE_TYPES.filter((t) => t !== "product_area").join(", ")}`);
        if (!n.title?.trim()) throw new ValidationError("node.title is required");
        for (const [id, k] of known) if (k.type === n.type && id !== n.id && similarity(k.title, n.title) >= 0.6)
          conflicts.push(`Possible duplicate of ${k.type} "${k.title}" (${id})`);
      } else if (p.kind === "evidence") {
        if (!Array.isArray(p.node_ids) || !p.node_ids.length) throw new ValidationError("node_ids[] is required");
        if (!p.quote?.trim()) throw new ValidationError("quote is required");
        for (const id of p.node_ids) { const k = need(id); if (p.stance === "contradicts") conflicts.push(`Contradicts ${k.type} "${k.title}"`); }
      } else throw new ValidationError('add.kind must be "node" or "evidence"');
    } else if (change === "update") {
      need(p.node_id);
      const keys = Object.keys(p.fields ?? {});
      if (!keys.length) throw new ValidationError("fields is empty");
      for (const k of keys) if (!(NODE_FIELDS as readonly string[]).includes(k)) throw new ValidationError(`cannot update field ${k}`);
    } else if (change === "link") {
      if (!EDGE_TYPES.includes(p.type)) throw new ValidationError(`type must be one of ${EDGE_TYPES.join(", ")}`);
      const a = need(p.from_id), b = need(p.to_id), rule = EDGE_RULES[p.type as EdgeType];
      if (!rule.from.includes(a.type) || !rule.to.includes(b.type))
        throw new ValidationError(`${p.type} must go from ${rule.from.join("|")} to ${rule.to.join("|")} (got ${a.type} → ${b.type})`);
      if (this.db.prepare("SELECT 1 FROM edges WHERE from_id=? AND to_id=? AND type=?").get(p.from_id, p.to_id, p.type)) conflicts.push("This link already exists");
    } else if (change === "flag") {
      need(p.node_id);
      if (!p.flag?.trim()) throw new ValidationError("flag is required");
    } else throw new ValidationError(`change_type must be one of ${CHANGE_TYPES.join(", ")}`);
    return conflicts;
  }

  createProposal(modelId: string, i: {
    actor: string; actor_type?: "human" | "agent"; change_type: string; payload: any; rationale?: string; source_ref?: any; batch_id?: string | null;
  }): ProposalRow {
    this.model(modelId);
    if (!i.actor?.trim()) throw new ValidationError("actor is required");
    const conflicts = this.validate(modelId, i.change_type, i.payload);
    const id = newId("p");
    const seq = ((this.db.prepare("SELECT COALESCE(MAX(seq),0) m FROM proposals WHERE model_id=?").get(modelId) as any).m as number) + 1;
    this.db.prepare(
      "INSERT INTO proposals(id,model_id,batch_id,actor,actor_type,change_type,payload,rationale,source_ref,status,conflicts,created_at,seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(id, modelId, i.batch_id ?? null, i.actor, i.actor_type ?? "agent", i.change_type, j(i.payload), i.rationale ?? "", j(i.source_ref), "pending", j(conflicts), now(), seq);
    let p = this.getProposal(id);
    // Optional auto-approve for low-risk evidence additions by agents (P1, off by default).
    if ((process.env.WM_AUTO_APPROVE ?? "none") === "evidence" && p.actor_type === "agent" && p.change_type === "add"
      && p.payload.kind === "evidence" && p.payload.stance !== "contradicts" && !conflicts.length
      && p.payload.node_ids.every((nid: string) => this.db.prepare("SELECT 1 FROM nodes WHERE id=?").get(nid))) {
      this.approve([id], "auto-approve (evidence only)");
      p = this.getProposal(id);
    }
    return p;
  }
  getProposal(id: string): ProposalRow {
    const r = this.db.prepare("SELECT * FROM proposals WHERE id=?").get(id);
    if (!r) throw new NotFoundError(`proposal ${id} not found`);
    return proposal(r);
  }
  listProposals(modelId: string, status?: string): ProposalRow[] {
    const rows = status
      ? this.db.prepare("SELECT * FROM proposals WHERE model_id=? AND status=? ORDER BY seq").all(modelId, status)
      : this.db.prepare("SELECT * FROM proposals WHERE model_id=? ORDER BY seq DESC").all(modelId);
    return rows.map(proposal);
  }

  /** Approve proposals as one new model version. `edits[id]` replaces the payload (human edit before accept). */
  approve(ids: string[], reviewer: string, edits: Record<string, any> = {}, note = ""): { version: number; applied: string[]; errors: Record<string, string> } {
    if (!ids.length) throw new ValidationError("no proposals given");
    const props = ids.map((id) => this.getProposal(id));
    const modelId = props[0].model_id;
    if (props.some((p) => p.model_id !== modelId)) throw new ValidationError("proposals belong to different models");
    const rank = (p: ProposalRow) => (p.change_type === "add" ? (p.payload?.kind === "node" ? 0 : 1) : { update: 2, link: 3, flag: 4 }[p.change_type] ?? 9);
    const ordered = props.sort((a, b) => rank(a) - rank(b));
    const errors: Record<string, string> = {}, applied: string[] = [];
    const m = this.model(modelId);
    const number = m.current_version + 1, log: ChangelogEntry[] = [];
    // Atomic version: the whole set applies or none of it does.
    tx(this.db, () => {
      for (const p of ordered) {
        if (p.status !== "pending") { errors[p.id] = `already ${p.status}`; continue; }
        try {
          if (edits[p.id]) { this.validate(modelId, p.change_type, edits[p.id]); p.payload = edits[p.id]; }
          const entry = this.applyOne(p, number);
          log.push({ proposal_id: p.id, actor: p.actor, actor_type: p.actor_type, at: now(), ...entry });
          this.db.prepare("UPDATE proposals SET status='accepted',reviewed_by=?,review_note=?,reviewed_at=?,payload=? WHERE id=?").run(reviewer, note, now(), j(p.payload), p.id);
          applied.push(p.id);
        } catch (e: any) { throw new ValidationError(`proposal ${p.id}: ${e.message}`); }
      }
      if (log.length) {
        this.db.prepare("INSERT INTO versions(id,model_id,number,changelog,created_at) VALUES (?,?,?,?,?)").run(newId("v"), modelId, number, j(log), now());
        this.db.prepare("UPDATE models SET current_version=? WHERE id=?").run(number, modelId);
      }
    });
    return { version: log.length ? number : m.current_version, applied, errors };
  }
  reject(ids: string[], reviewer: string, note = "") {
    for (const id of ids) {
      const p = this.getProposal(id);
      if (p.status !== "pending") continue;
      this.db.prepare("UPDATE proposals SET status='rejected',reviewed_by=?,review_note=?,reviewed_at=? WHERE id=?").run(reviewer, note, now(), id);
    }
  }

  private insertEvidence(modelId: string, nodeIds: string[], ev: any, actor: string): string {
    let source: SourceRow | null = ev.source_id ? (this.db.prepare("SELECT * FROM sources WHERE id=?").get(ev.source_id) as any) ?? null : null;
    if (!source && ev.source) {
      source = this.addSource(modelId, { type: ev.source.type ?? "agent_note", label: ev.source.label ?? ev.source.uri ?? "", filename: ev.source.uri ?? "", text: ev.source.text ?? ev.quote, source_date: ev.source.date });
    }
    let start: number | null = null, end: number | null = null;
    if (source) {
      const at = locateQuote(source.text, ev.quote);
      if (at) [start, end] = at;
    }
    const id = newId("e");
    this.db.prepare("INSERT INTO evidence(id,model_id,node_ids,source_id,quote,span_start,span_end,source_date,source_type,stance,actor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      id, modelId, j(nodeIds), source?.id ?? null, ev.quote, start, end, ev.source_date ?? source?.source_date ?? now(), source?.type ?? ev.source_type ?? "note", ev.stance === "contradicts" ? "contradicts" : "supports", actor, now(),
    );
    return id;
  }

  private applyOne(p: ProposalRow, version: number): Pick<ChangelogEntry, "change_type" | "summary" | "diff"> {
    const m = p.model_id, t = now(), pl = p.payload;
    const get = (id: string) => { const r = this.db.prepare("SELECT * FROM nodes WHERE id=?").get(id); if (!r) throw new NotFoundError(`node ${id} does not exist yet (accept it first)`); return node(r); };
    if (p.change_type === "add" && pl.kind === "node") {
      const n = pl.node, id = n.id ?? newId("n");
      this.db.prepare("INSERT INTO nodes(id,model_id,type,title,description,status,owner,confidence,flags,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
        id, m, n.type, n.title.trim(), n.description ?? "", n.status ?? (n.type === "feature" ? "proposed" : ""), n.owner ?? "", n.confidence ?? "medium", "[]", t, t, version);
      for (const ev of pl.evidence ?? []) this.insertEvidence(m, [id], ev, p.actor);
      return { change_type: "add", summary: `Added ${n.type} "${n.title.trim()}"`, diff: { before: null, after: { id, type: n.type, title: n.title, description: n.description ?? "" } } };
    }
    if (p.change_type === "add") {
      const nodes = pl.node_ids.map(get);
      const eid = this.insertEvidence(m, pl.node_ids, pl, p.actor);
      const touch = this.db.prepare("UPDATE nodes SET updated_at=?,version=? WHERE id=?");
      for (const id of pl.node_ids) touch.run(t, version, id);
      return { change_type: "add", summary: `Added ${pl.stance === "contradicts" ? "contradicting " : ""}evidence to ${nodes.map((n: NodeRow) => `"${n.title}"`).join(", ")}`, diff: { before: null, after: { evidence_id: eid, node_ids: pl.node_ids, quote: pl.quote, stance: pl.stance ?? "supports" } } };
    }
    if (p.change_type === "update") {
      const before = get(pl.node_id), sets: string[] = [], vals: any[] = [], b: any = {}, a: any = {};
      for (const [k, v] of Object.entries(pl.fields)) { sets.push(`${k}=?`); vals.push(v); b[k] = (before as any)[k]; a[k] = v; }
      this.db.prepare(`UPDATE nodes SET ${sets.join(",")},updated_at=?,version=? WHERE id=?`).run(...vals, t, version, pl.node_id);
      return { change_type: "update", summary: `Updated ${before.type} "${before.title}" (${Object.keys(a).join(", ")})`, diff: { before: { id: pl.node_id, ...b }, after: { id: pl.node_id, ...a } } };
    }
    if (p.change_type === "link") {
      const a = get(pl.from_id), b = get(pl.to_id);
      this.db.prepare("INSERT INTO edges(id,model_id,from_id,to_id,type,confidence) VALUES (?,?,?,?,?,?)").run(newId("g"), m, pl.from_id, pl.to_id, pl.type, pl.confidence ?? "medium");
      return { change_type: "link", summary: `Linked "${a.title}" —${pl.type}→ "${b.title}"`, diff: { before: null, after: { from_id: pl.from_id, to_id: pl.to_id, type: pl.type } } };
    }
    // flag
    const n = get(pl.node_id), flags = [...n.flags, { flag: pl.flag, note: pl.note ?? "", actor: p.actor, at: t }];
    this.db.prepare("UPDATE nodes SET flags=?,updated_at=?,version=? WHERE id=?").run(j(flags), t, version, pl.node_id);
    if (pl.evidence) this.insertEvidence(m, [pl.node_id], { ...pl.evidence, stance: "contradicts" }, p.actor);
    return { change_type: "flag", summary: `Flagged ${n.type} "${n.title}" as ${pl.flag}`, diff: { before: { id: n.id, flags: n.flags }, after: { id: n.id, flags } } };
  }

  /** Clear a flag on a node (owner action, versioned like any change). */
  resolveFlag(nodeId: string, flag: string, reviewer: string): { version: number } {
    const n = node(this.db.prepare("SELECT * FROM nodes WHERE id=?").get(nodeId) ?? (() => { throw new NotFoundError("node not found"); })());
    const m = this.model(n.model_id), number = m.current_version + 1, t = now();
    const flags = n.flags.filter((f) => f.flag !== flag);
    tx(this.db, () => {
      this.db.prepare("UPDATE nodes SET flags=?,updated_at=?,version=? WHERE id=?").run(j(flags), t, number, nodeId);
      this.db.prepare("INSERT INTO versions(id,model_id,number,changelog,created_at) VALUES (?,?,?,?,?)").run(newId("v"), n.model_id, number, j([{ proposal_id: null, actor: reviewer, actor_type: "human", at: t, change_type: "flag", summary: `Resolved flag "${flag}" on ${n.type} "${n.title}"`, diff: { before: { id: n.id, flags: n.flags }, after: { id: n.id, flags } } }]), t);
      this.db.prepare("UPDATE models SET current_version=? WHERE id=?").run(number, n.model_id);
    });
    return { version: number };
  }

  // ---------- health ----------
  health(modelId: string, staleDays = 30) {
    const g = this.graph(modelId), by = g.byId;
    const out = (id: string, type: EdgeType) => g.edges.filter((e) => e.from_id === id && e.type === type).map((e) => e.to_id);
    const inn = (id: string, type: EdgeType) => g.edges.filter((e) => e.to_id === id && e.type === type).map((e) => e.from_id);
    const outcomesOfFeature = (f: string) => {
      const s = new Set<string>();
      for (const t of out(f, "addresses")) {
        if (by.get(t)?.type === "outcome") s.add(t);
        else if (by.get(t)?.type === "problem") inn(t, "blocked_by").forEach((o) => s.add(o));
      }
      return s;
    };
    const features = g.nodes.filter((n) => n.type === "feature"), outcomes = g.nodes.filter((n) => n.type === "outcome");
    const featOutcomes = new Map(features.map((f) => [f.id, outcomesOfFeature(f.id)]));
    const ref = (n: NodeRow, reason: string) => ({ id: n.id, title: n.title, type: n.type, reason });

    const orphans = features.flatMap((f) => {
      const noO = !featOutcomes.get(f.id)!.size, noM = !out(f.id, "moves").length;
      return noO || noM ? [ref(f, noO && noM ? "No path to an outcome or a metric" : noO ? "No path to an outcome" : "Moves no metric")] : [];
    });
    const outcomeFeatures = (o: string) => features.filter((f) => featOutcomes.get(f.id)!.has(o));
    const gaps = outcomes.filter((o) => !outcomeFeatures(o.id).length).map((o) => ref(o, "No feature addresses this outcome"));
    const unmeasured = outcomes.filter((o) => { const fs = outcomeFeatures(o.id); return fs.length && !fs.some((f) => out(f.id, "moves").length); }).map((o) => ref(o, "Features exist but none moves a metric"));
    const unowned = outcomes.filter((o) => !inn(o.id, "wants").length).map((o) => ref(o, "No user segment wants this outcome"));

    const latest = new Map<string, string>();
    for (const e of g.evidence) for (const id of e.node_ids) if (!latest.has(id) || e.source_date > latest.get(id)!) latest.set(id, e.source_date);
    const ageDays = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
    const content = g.nodes.filter((n) => n.type !== "product_area");
    const ages = content.map((n) => ageDays(latest.get(n.id) ?? n.updated_at)).sort((a, b) => a - b);
    const stale = content.filter((n) => ageDays(latest.get(n.id) ?? n.updated_at) > staleDays)
      .map((n) => ref(n, `No new evidence in ${ageDays(latest.get(n.id) ?? n.updated_at)} days`));
    const contradictedIds = new Set<string>(g.evidence.filter((e) => e.stance === "contradicts").flatMap((e) => e.node_ids));
    const contradictions = content.filter((n) => contradictedIds.has(n.id) || n.flags.some((f) => f.flag === "conflict"))
      .map((n) => ref(n, n.flags.find((f) => f.flag === "conflict")?.note || "Contradicting evidence recorded"));
    const withEv = new Set(g.evidence.flatMap((e) => e.node_ids));
    const unsupported = content.filter((n) => !withEv.has(n.id)).map((n) => ref(n, "No evidence attached"));

    const covered = outcomes.filter((o) => { const fs = outcomeFeatures(o.id); return fs.length && fs.some((f) => out(f.id, "moves").length); }).length;
    const flagged = new Map<string, string[]>();
    const mark = (list: { id: string }[], label: string) => list.forEach((x) => flagged.set(x.id, [...(flagged.get(x.id) ?? []), label]));
    mark(orphans, "orphan"); mark(gaps, "gap"); mark(unmeasured, "unmeasured"); mark(stale, "stale"); mark(contradictions, "contradiction"); mark(unowned, "unowned");
    return {
      orphans, gaps, unmeasured, unowned_outcomes: unowned, stale, contradictions, unsupported,
      coverage: { outcomes: outcomes.length, covered, score: outcomes.length ? Math.round((covered / outcomes.length) * 100) : 0 },
      median_node_age_days: ages.length ? ages[Math.floor(ages.length / 2)] : null,
      stale_after_days: staleDays,
      flags_by_node: Object.fromEntries(flagged),
    };
  }

  // ---------- trace ----------
  trace(nodeId: string) {
    const r = this.db.prepare("SELECT * FROM nodes WHERE id=?").get(nodeId);
    if (!r) throw new NotFoundError(`node ${nodeId} not found`);
    const start = node(r), g = this.graph(start.model_id), by = g.byId;
    const out = (id: string, t: EdgeType) => g.edges.filter((e) => e.from_id === id && e.type === t).map((e) => e.to_id);
    const inn = (id: string, t: EdgeType) => g.edges.filter((e) => e.to_id === id && e.type === t).map((e) => e.from_id);
    const set = new Set<string>([nodeId]);
    const outcomeUp = (o: string) => { set.add(o); inn(o, "wants").forEach((s) => set.add(s)); };
    const featurePath = (f: string) => {
      set.add(f);
      for (const t of out(f, "addresses")) {
        set.add(t);
        if (by.get(t)?.type === "outcome") outcomeUp(t);
        else inn(t, "blocked_by").forEach(outcomeUp);
      }
      out(f, "moves").forEach((m) => set.add(m));
    };
    const featuresFor = (targets: string[]) => g.nodes.filter((n) => n.type === "feature" && out(n.id, "addresses").some((t) => targets.includes(t))).map((n) => n.id);
    switch (start.type) {
      case "feature": featurePath(nodeId); break;
      case "metric": inn(nodeId, "moves").forEach(featurePath); break;
      case "problem": inn(nodeId, "blocked_by").forEach(outcomeUp); featuresFor([nodeId]).forEach(featurePath); break;
      case "outcome": case "segment": {
        const outs = start.type === "segment" ? out(nodeId, "wants") : [nodeId];
        for (const o of outs) { outcomeUp(o); const ps = out(o, "blocked_by"); ps.forEach((p) => set.add(p)); featuresFor([o, ...ps]).forEach(featurePath); }
        break;
      }
      default: g.edges.filter((e) => e.from_id === nodeId).forEach((e) => set.add(e.to_id));
    }
    const nodes = [...set].map((id) => by.get(id)!).filter(Boolean);
    return { start, nodes, edges: g.edges.filter((e) => set.has(e.from_id) && set.has(e.to_id)) };
  }

  // ---------- query for agents ----------
  query(modelId: string, task: string, limit = 8) {
    const g = this.graph(modelId), by = g.byId, m = this.model(modelId);
    const q = new Set(tokens(task));
    const typeHint: Partial<Record<NodeType, string[]>> = {
      metric: ["metric", "kpi", "measure", "success", "target", "goal"], feature: ["feature", "initiative", "build", "ship", "roadmap"],
      segment: ["user", "persona", "segment", "audience"], outcome: ["outcome", "jtbd", "job"], problem: ["problem", "pain", "friction", "blocker"],
    };
    const scores = new Map<string, number>();
    for (const n of g.nodes) {
      if (n.type === "product_area") continue;
      let s = 0;
      for (const t of tokens(n.title)) if (q.has(t)) s += 3;
      for (const t of tokens(n.description)) if (q.has(t)) s += 1;
      for (const t of typeHint[n.type] ?? []) if (task.toLowerCase().includes(t)) s += 1.5;
      scores.set(n.id, s);
    }
    for (const e of g.evidence) for (const id of e.node_ids) for (const t of tokens(e.quote)) if (q.has(t)) scores.set(id, (scores.get(id) ?? 0) + 0.5);
    const seeds = [...scores].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
    const set = new Set<string>(seeds);
    for (const id of seeds) for (const n of this.trace(id).nodes) set.add(n.id);
    // Always give the user context: segments wanting any included outcome.
    g.nodes.filter((n) => n.type === "product_area").forEach((n) => set.add(n.id));
    const nodes = [...set].map((id) => by.get(id)!).filter(Boolean);
    const evCount = (id: string) => g.evidence.filter((e) => e.node_ids.includes(id));
    const health = this.health(modelId);
    const flagged = (id: string) => health.flags_by_node[id] ?? [];
    return {
      model: { id: m.id, name: m.name, version: m.current_version }, task, matched: seeds,
      nodes: nodes.map((n) => ({ ...n, health_flags: flagged(n.id), evidence: evCount(n.id).slice(0, 3).map((e) => ({ quote: e.quote, stance: e.stance, source_type: e.source_type, source_date: e.source_date })) })),
      edges: g.edges.filter((e) => set.has(e.from_id) && set.has(e.to_id)),
      summary: narrative(m.name, nodes, g, flagged),
      known_gaps: [...health.gaps, ...health.orphans, ...health.unmeasured].filter((x) => set.has(x.id)),
    };
  }

  exportModel(modelId: string, format: "json" | "md" = "md") {
    const g = this.graph(modelId), m = this.model(modelId), h = this.health(modelId);
    if (format === "json") return { model: m, nodes: g.nodes, edges: g.edges, evidence: g.evidence, health: h };
    return exportMarkdown(m, g, h);
  }
}

/** Find `quote` in `text` ignoring whitespace differences; returns [start,end) offsets into the original text. */
export function locateQuote(text: string, quote: string): [number, number] | null {
  const direct = text.indexOf(quote);
  if (direct >= 0) return [direct, direct + quote.length];
  const words = quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length || !words[0]) return null;
  const m = new RegExp(words.join("\\s+"), "i").exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

function narrative(area: string, nodes: NodeRow[], g: Graph, flagged: (id: string) => string[]): string {
  const of = (t: NodeType) => nodes.filter((n) => n.type === t);
  const list = (ns: NodeRow[]) => ns.map((n) => n.title).join("; ") || "none yet";
  const lines = [`Product area: ${area}.`, `Users: ${list(of("segment"))}.`, `Outcomes they want: ${list(of("outcome"))}.`,
    `Obstacles: ${list(of("problem"))}.`, `Features serving them: ${of("feature").map((f) => `${f.title} (${f.status || "unknown"})`).join("; ") || "none yet"}.`,
    `Success metrics: ${list(of("metric"))}.`];
  const dec = of("decision"), ass = of("assumption");
  if (dec.length) lines.push(`Decisions on record: ${list(dec)}.`);
  if (ass.length) lines.push(`Open assumptions/questions: ${list(ass)}.`);
  const bad = nodes.filter((n) => flagged(n.id).length).map((n) => `${n.title} [${flagged(n.id).join(", ")}]`);
  if (bad.length) lines.push(`Health warnings: ${bad.join("; ")}.`);
  void g;
  return lines.join("\n");
}

function exportMarkdown(m: any, g: Graph, h: ReturnType<Service["health"]>): string {
  const out = (id: string, t: EdgeType) => g.edges.filter((e) => e.from_id === id && e.type === t).map((e) => g.byId.get(e.to_id)!).filter(Boolean);
  const ev = (id: string) => g.evidence.filter((e) => e.node_ids.includes(id));
  const L: string[] = [`# World model: ${m.name}`, `_Version ${m.current_version} · coverage ${h.coverage.score}% · ${g.nodes.length - 1} nodes_`, ""];
  const quote = (id: string) => ev(id).slice(0, 2).map((e) => `  - ${e.stance === "contradicts" ? "(contradicts) " : ""}“${e.quote}” — ${e.source_type}, ${e.source_date.slice(0, 10)}`).join("\n");
  for (const s of g.nodes.filter((n) => n.type === "segment")) {
    L.push(`## User: ${s.title}`, s.description, "");
    for (const o of out(s.id, "wants")) {
      L.push(`### Outcome: ${o.title}`, o.description);
      const q = quote(o.id); if (q) L.push(q);
      for (const p of out(o.id, "blocked_by")) { L.push(`- **Problem:** ${p.title} — ${p.description}`); const pq = quote(p.id); if (pq) L.push(pq); }
      const feats = g.nodes.filter((f) => f.type === "feature" && (out(f.id, "addresses").some((t) => t.id === o.id || out(o.id, "blocked_by").some((p) => p.id === t.id))));
      for (const f of feats) L.push(`- **Feature (${f.status}):** ${f.title} → moves ${out(f.id, "moves").map((x) => x.title).join(", ") || "no metric"}`);
      L.push("");
    }
  }
  const sec = (title: string, type: NodeType) => { const ns = g.nodes.filter((n) => n.type === type); if (ns.length) L.push(`## ${title}`, ...ns.map((n) => `- **${n.title}** — ${n.description}`), ""); };
  sec("Success metrics", "metric"); sec("Decisions", "decision"); sec("Assumptions and open questions", "assumption");
  L.push("## Health", `- Orphan features: ${h.orphans.map((x) => x.title).join("; ") || "none"}`, `- Outcome gaps: ${h.gaps.map((x) => x.title).join("; ") || "none"}`,
    `- Contradictions: ${h.contradictions.map((x) => x.title).join("; ") || "none"}`, `- Stale: ${h.stale.length}`);
  return L.join("\n");
}

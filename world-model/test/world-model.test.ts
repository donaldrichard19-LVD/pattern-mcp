import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openDb } from "../src/db.ts";
import { Service, ValidationError, locateQuote } from "../src/service.ts";
import { seedDemo, DEMO_SOURCES } from "../src/seed.ts";
import { slackToText, guessType } from "../src/parse.ts";
import { ingestSource, taggedLineExtract } from "../src/extract.ts";
import { createApp } from "../src/server.ts";
import { buildMcp } from "../src/mcp.ts";

const fresh = () => new Service(openDb(":memory:"));
const seeded = async () => { const svc = fresh(); const id = await seedDemo(svc); return { svc, id }; };
const byTitle = (svc: Service, id: string, re: RegExp) => svc.graph(id).nodes.find((n) => re.test(n.title))!;

test("every curated demo quote appears verbatim in its source", () => {
  const dir = new URL("../demo/", import.meta.url).pathname;
  for (const s of DEMO_SOURCES) {
    const raw = readFileSync(join(dir, "sources", s.file), "utf8");
    const text = s.file.endsWith(".json") ? slackToText(raw).text : raw;
    const ex = JSON.parse(readFileSync(join(dir, "extractions", s.file.replace(/\.[^.]+$/, "") + ".json"), "utf8"));
    const quotes = [...ex.nodes.map((n: any) => n.quote), ...(ex.evidence ?? []).map((e: any) => e.quote)].filter(Boolean);
    for (const q of quotes) assert.ok(locateQuote(text, q), `quote not in ${s.file}: ${q}`);
  }
  assert.equal(readdirSync(join(dir, "extractions")).length, DEMO_SOURCES.length);
});

test("demo seed builds the expected graph with provenance on every node", async () => {
  const { svc, id } = await seeded();
  const m = svc.getModel(id);
  assert.equal(m.nodes.length, 26);
  assert.equal(m.edges.length, 25);
  assert.equal(m.version, 6);
  for (const n of m.nodes.filter((n) => n.type !== "product_area")) assert.ok(n.evidence_count > 0, `${n.title} has no evidence`);
  // Granola and Zoom are evidence, never nodes.
  assert.ok(!m.nodes.some((n) => /granola|zoom/i.test(n.title)));
  const p5 = svc.getNode(byTitle(svc, id, /AI meeting notes are unstructured/).id);
  const types = p5.evidence.map((e: any) => `${e.source_type}:${e.source.label}`).sort();
  assert.deepEqual(types, ["research_input:Granola", "research_input:Granola", "research_input:Zoom AI", "research_input:Zoom AI"]);
  for (const e of p5.evidence) assert.ok(e.span_start !== null && e.span_end! > e.span_start);
});

test("health: orphans, gaps, contradictions, staleness, coverage", async () => {
  const { svc, id } = await seeded();
  const h = svc.health(id);
  assert.deepEqual(h.orphans.map((o) => o.title).sort(), ["Dark mode editor", "Decision log sidebar"]);
  assert.match(h.gaps[0].title, /Turn meeting conversations/);
  assert.match(h.contradictions[0].title, /trust AI-suggested metrics/);
  assert.match(h.stale[0].title, /Context is scattered/);
  assert.equal(h.coverage.score, 80);
  assert.equal(svc.health(id, 100).stale.length, 0);
});

test("agent write-back: proposal does not change the model until approved, then versions and logs", async () => {
  const { svc, id } = await seeded();
  const p5 = byTitle(svc, id, /AI meeting notes are unstructured/);
  const before = svc.getModel(id);
  const prop = svc.createProposal(id, {
    actor: "test-agent", change_type: "add", rationale: "new insight",
    payload: { kind: "evidence", node_ids: [p5.id], quote: "Four PMs described pasting AI meeting notes into a draft.", source: { type: "research", uri: "r.md", date: "2026-10-01T00:00:00Z" } },
  });
  assert.equal(prop.status, "pending");
  assert.equal(svc.getModel(id).version, before.version);
  assert.equal(svc.getNode(p5.id).evidence.length, 4);
  const r = svc.approve([prop.id], "don");
  assert.equal(r.version, before.version + 1);
  assert.equal(svc.getNode(p5.id).evidence.length, 5);
  const top = svc.changelog(id)[0];
  assert.equal(top.number, r.version);
  assert.equal(top.changelog[0].actor, "test-agent");
  assert.equal(top.changelog[0].diff.before, null);
  assert.equal(svc.getProposal(prop.id).reviewed_by, "don");
  assert.ok(svc.getNode(p5.id).history.length >= 1);
});

test("rejected proposals change nothing; approved ones cannot be re-approved", async () => {
  const { svc, id } = await seeded();
  const f = byTitle(svc, id, /Dark mode/);
  const p = svc.createProposal(id, { actor: "a", change_type: "update", payload: { node_id: f.id, fields: { status: "shipped" } } });
  svc.reject([p.id], "don", "no");
  assert.equal(svc.graph(id).byId.get(f.id)!.status, "proposed");
  const q = svc.createProposal(id, { actor: "a", change_type: "update", payload: { node_id: f.id, fields: { status: "in-flight" } } });
  svc.approve([q.id], "don");
  assert.equal(svc.graph(id).byId.get(f.id)!.status, "in-flight");
  assert.match(svc.approve([q.id], "don").errors[q.id], /already accepted/);
});

test("owner can edit a proposal before approving", async () => {
  const { svc, id } = await seeded();
  const p = svc.createProposal(id, { actor: "a", change_type: "add", payload: { kind: "node", node: { type: "assumption", title: "Teams want a changelog per PRD" } } });
  svc.approve([p.id], "don", { [p.id]: { kind: "node", node: { type: "assumption", title: "Teams want a changelog for every PRD" } } });
  assert.ok(byTitle(svc, id, /changelog for every PRD/));
});

test("validation: bad edges, unknown nodes, bad types are rejected at submission", async () => {
  const { svc, id } = await seeded();
  const seg = byTitle(svc, id, /Product managers/), feat = byTitle(svc, id, /Dark mode/);
  assert.throws(() => svc.createProposal(id, { actor: "a", change_type: "link", payload: { from_id: seg.id, to_id: feat.id, type: "moves" } }), ValidationError);
  assert.throws(() => svc.createProposal(id, { actor: "a", change_type: "link", payload: { from_id: "nope", to_id: feat.id, type: "moves" } }), /unknown node/);
  assert.throws(() => svc.createProposal(id, { actor: "a", change_type: "add", payload: { kind: "node", node: { type: "widget", title: "x" } } }), ValidationError);
  assert.throws(() => svc.createProposal(id, { actor: "a", change_type: "update", payload: { node_id: feat.id, fields: { id: "z" } } }), /cannot update/);
  assert.throws(() => svc.createProposal(id, { actor: "", change_type: "flag", payload: { node_id: feat.id, flag: "x" } }), /actor/);
});

test("conflict detection: duplicate nodes, contradicting evidence, repeated links", async () => {
  const { svc, id } = await seeded();
  const dup = svc.createProposal(id, { actor: "a", change_type: "add", payload: { kind: "node", node: { type: "feature", title: "Stale document alerts" } } });
  assert.match(dup.conflicts[0], /Possible duplicate/);
  const a1 = byTitle(svc, id, /trust AI-suggested/);
  const c = svc.createProposal(id, { actor: "a", change_type: "add", payload: { kind: "evidence", node_ids: [a1.id], quote: "q", stance: "contradicts", source: { type: "note", uri: "x" } } });
  assert.match(c.conflicts[0], /Contradicts/);
  const [s1, o1] = [byTitle(svc, id, /Product managers/), byTitle(svc, id, /first draft/)];
  const l = svc.createProposal(id, { actor: "a", change_type: "link", payload: { from_id: s1.id, to_id: o1.id, type: "wants" } });
  assert.match(l.conflicts[0], /already exists/);
});

test("approval is atomic: one bad proposal leaves the model untouched", async () => {
  const { svc, id } = await seeded();
  const f = byTitle(svc, id, /Dark mode/), v = svc.getModel(id).version;
  const good = svc.createProposal(id, { actor: "a", change_type: "update", payload: { node_id: f.id, fields: { title: "Dark theme" } } });
  const bad = svc.createProposal(id, { actor: "a", change_type: "link", payload: { from_id: f.id, to_id: byTitle(svc, id, /first draft/).id, type: "addresses" } });
  svc.approve([bad.id], "don"); // valid once
  const dupe = svc.db.prepare("UPDATE proposals SET status='pending' WHERE id=?");
  dupe.run(bad.id);
  assert.throws(() => svc.approve([good.id, bad.id], "don"), /UNIQUE|constraint/);
  assert.equal(svc.graph(id).byId.get(f.id)!.title, "Dark mode editor");
  assert.equal(svc.getModel(id).version, v + 1);
});

test("fixing an orphan via write-back raises coverage and clears the flag", async () => {
  const { svc, id } = await seeded();
  const f = byTitle(svc, id, /Decision log sidebar/), m = byTitle(svc, id, /Median days since/);
  const p = svc.createProposal(id, { actor: "a", change_type: "link", payload: { from_id: f.id, to_id: m.id, type: "moves" } });
  svc.approve([p.id], "don");
  assert.ok(!svc.health(id).orphans.some((o) => o.id === f.id));
});

test("trace: feature to users and metrics; metric to its feeders", async () => {
  const { svc, id } = await seeded();
  const t = svc.trace(byTitle(svc, id, /Metric suggestion assistant/).id);
  const titles = t.nodes.map((n) => n.type + ":" + n.title);
  assert.ok(titles.some((x) => x.startsWith("segment:Product managers")));
  assert.ok(titles.some((x) => x.startsWith("outcome:Define success metrics")));
  assert.ok(titles.some((x) => x.startsWith("metric:Share of PRDs")));
  const mt = svc.trace(byTitle(svc, id, /Time to first draft/).id);
  assert.ok(mt.nodes.some((n) => n.title === "Template-guided PRD drafting"));
  assert.ok(!svc.trace(byTitle(svc, id, /Dark mode/).id).nodes.some((n) => n.type === "metric"));
});

test("query returns a relevant subgraph, summary and evidence", async () => {
  const { svc, id } = await seeded();
  const q = svc.query(id, "draft a PRD section for the success metrics of a new feature");
  assert.ok(q.nodes.some((n) => n.type === "metric"));
  assert.ok(q.nodes.some((n) => n.type === "segment"));
  assert.ok(q.nodes.find((n: any) => n.type === "outcome" && n.evidence.length));
  assert.match(q.summary, /Users:/);
  const none = svc.query(id, "zzzz qqqq");
  assert.deepEqual(none.matched, []);
});

test("auto-approve (evidence-only) applies agent evidence to existing nodes but not contradictions", async () => {
  const { svc, id } = await seeded();
  process.env.WM_AUTO_APPROVE = "evidence";
  try {
    const f = byTitle(svc, id, /Dark mode/);
    const ok = svc.createProposal(id, { actor: "bot", change_type: "add", payload: { kind: "evidence", node_ids: [f.id], quote: "another request", source: { type: "note", uri: "u" } } });
    assert.equal(ok.status, "accepted");
    const no = svc.createProposal(id, { actor: "bot", change_type: "add", payload: { kind: "evidence", node_ids: [f.id], quote: "x", stance: "contradicts", source: { type: "note", uri: "u" } } });
    assert.equal(no.status, "pending");
  } finally { delete process.env.WM_AUTO_APPROVE; }
});

test("incremental re-ingestion merges into existing nodes instead of duplicating", async () => {
  const { svc, id } = await seeded();
  const before = svc.graph(id).nodes.length;
  const src = svc.addSource(id, { type: "note", filename: "zoom-ai-excerpts.md", text: readFileSync(new URL("../demo/sources/zoom-ai-excerpts.md", import.meta.url), "utf8") });
  const r = await ingestSource(svc, src.id);
  assert.ok(r.merged.length >= 2);
  const ids = svc.listProposals(id, "pending").map((p) => p.id);
  svc.approve(ids, "don");
  assert.equal(svc.graph(id).nodes.length, before);
});

test("offline tagged-line extraction works for uncurated documents", async () => {
  process.env.WM_OFFLINE = "1";
  try {
    const svc = fresh(), { id } = svc.createModel("x");
    const src = svc.addSource(id, { type: "note", filename: "no-curated.md", text: "Outcome: Ship faster\nProblem: Reviews are slow\nplain prose" });
    const r = await ingestSource(svc, src.id);
    assert.equal(r.method, "tagged-lines");
    assert.equal(r.proposals, 2);
    const empty = svc.addSource(id, { type: "note", filename: "empty.md", text: "nothing tagged here" });
    await assert.rejects(ingestSource(svc, empty.id), /found nothing/);
  } finally { delete process.env.WM_OFFLINE; }
});

test("extraction drops quotes that are not in the source (no hallucinated provenance)", async () => {
  const svc = fresh(), { id } = svc.createModel("x");
  const src = svc.addSource(id, { type: "note", filename: "a.md", text: "We want faster reviews. Reviews take days." });
  const fake = async () => ({ method: "fake-llm", raw: {
    nodes: [
      { ref: "a", type: "outcome" as const, title: "Faster reviews", quote: "We want faster reviews." },
      { ref: "b", type: "problem" as const, title: "Reviews are slow", quote: "Reviews take weeks and nobody cares." },
      { ref: "c", type: "feature" as const, title: "", quote: "x" },
    ],
    edges: [{ from: "a", to: "b", type: "blocked_by" as const }, { from: "b", to: "a", type: "wants" as const }],
  } });
  const r = await ingestSource(svc, src.id, "x", fake);
  const props = svc.listProposals(id, "pending");
  const outcome = props.find((p) => p.payload.node?.type === "outcome")!, problem = props.find((p) => p.payload.node?.type === "problem")!;
  assert.equal(outcome.payload.evidence.length, 1);
  assert.equal(problem.payload.evidence.length, 0);
  assert.equal(problem.payload.node.confidence, "low");
  assert.ok(r.skipped.some((s) => /bad type\/title/.test(s)));
  assert.ok(r.skipped.some((s) => /violates schema/.test(s)));
  assert.equal(props.filter((p) => p.change_type === "link").length, 1);
  assert.deepEqual(locateQuote(src.text, "we want   faster\nreviews."), [0, 23]);
});

test("slack export and file type handling", () => {
  assert.throws(() => slackToText("not json"), ValidationError);
  assert.throws(() => slackToText("[]"), /no messages/);
  assert.equal(guessType("granola-reviews.md").label, "Granola");
  assert.equal(guessType("Zoom_AI.txt").type, "research_input");
});

test("REST API: read, query, proposals, approval, token gating, 404/400", async () => {
  process.env.WM_OWNER_TOKEN = "secret";
  const { svc, id } = await seeded();
  const srv = createServer(createApp(svc));
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const call = async (path: string, init: any = {}, owner = false) => {
    const r = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(owner ? { authorization: "Bearer secret" } : {}), ...init.headers } });
    return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() };
  };
  try {
    assert.equal((await call(`/models/${id}`)).body.nodes.length, 26);
    assert.ok((await call(`/models/${id}/query?task=success%20metrics`)).body.nodes.length > 3);
    assert.equal((await call(`/models/${id}/query`)).status, 400);
    assert.equal((await call(`/nodes/missing`)).status, 404);
    assert.match((await call(`/models/${id}/export?format=md`)).body, /# World model/);
    assert.equal((await call(`/`)).status, 200);
    const n = byTitle(svc, id, /Dark mode/);
    const created = await call(`/models/${id}/proposals`, { method: "POST", headers: { "x-actor": "curl-agent" }, body: JSON.stringify({ change_type: "flag", payload: { node_id: n.id, flag: "conflict", note: "n" }, rationale: "r" }) });
    assert.equal(created.status, 201);
    assert.equal(created.body.actor, "curl-agent");
    assert.equal((await call(`/proposals/approve`, { method: "POST", body: JSON.stringify({ ids: [created.body.id] }) })).status, 403);
    const ok = await call(`/proposals/approve`, { method: "POST", body: JSON.stringify({ ids: [created.body.id] }) }, true);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.version, 7);
    assert.equal((await call(`/models/${id}/proposals`, { method: "POST", body: JSON.stringify({ change_type: "bogus", payload: {} , actor: "a"}) })).status, 400);
    // upload a markdown file through the API and review it
    const up = await call(`/models/${id}/sources`, { method: "POST", body: JSON.stringify({ filename: "notes.md", content_base64: Buffer.from("Feature: Offline editing\nMetric: Weekly active editors").toString("base64") }) }, true);
    assert.equal(up.status, 201);
    assert.equal(up.body.ingestion.proposals, 2);
  } finally { srv.close(); delete process.env.WM_OWNER_TOKEN; }
});

test("MCP server exposes read and write-back tools", async () => {
  const { svc, id } = await seeded();
  const server = buildMcp(svc, "mcp-test");
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  for (const n of ["get_world_model", "search_world_model", "get_node", "trace_feature", "propose_update", "add_evidence", "flag_conflict"]) assert.ok(names.includes(n), n);
  const text = (r: any) => r.content[0].text as string;
  const s = JSON.parse(text(await client.callTool({ name: "search_world_model", arguments: { task: "success metrics" } })));
  assert.ok(s.nodes.length);
  const md = text(await client.callTool({ name: "get_world_model", arguments: {} }));
  assert.match(md, /Outcome:/);
  const f = byTitle(svc, id, /Metric suggestion assistant/);
  const tr = JSON.parse(text(await client.callTool({ name: "trace_feature", arguments: { node_id: f.id } })));
  assert.ok(tr.nodes.some((n: any) => n.type === "metric"));
  const ev = JSON.parse(text(await client.callTool({ name: "add_evidence", arguments: { node_ids: [f.id], quote: "PMs want to see why", source_uri: "call-notes.md" } })));
  assert.equal(ev.status, "pending");
  assert.equal(ev.actor, "mcp-test");
  const fl = JSON.parse(text(await client.callTool({ name: "flag_conflict", arguments: { node_id: f.id, note: "Contradicts brief", contradicting_quote: "q", source_uri: "u" } })));
  assert.equal(fl.change_type, "flag");
  const bad = await client.callTool({ name: "propose_update", arguments: { change_type: "link", payload: { from_id: "x", to_id: "y", type: "wants" }, rationale: "r" } });
  assert.equal(bad.isError, true);
  assert.equal(svc.listProposals(id, "pending").length, 2);
});

test("end to end demo loop: read, find new insight, write back, approve, map and changelog update", async () => {
  const { svc, id } = await seeded();
  const ctx = svc.query(id, "draft a PRD section for the success metrics of a new feature");
  assert.ok(ctx.summary);
  const p5 = byTitle(svc, id, /AI meeting notes are unstructured/);
  const insight = readFileSync(new URL("../demo/sources/research-pm-writing-summary.md", import.meta.url), "utf8").split("\n").find((l) => /Four PMs/.test(l))!.replace(/^\d+\.\s*/, "");
  assert.ok(!svc.getNode(p5.id).evidence.some((e: any) => e.quote === insight));
  const prop = svc.createProposal(id, { actor: "demo-prd-agent", change_type: "add", rationale: "x", payload: { kind: "evidence", node_ids: [p5.id], quote: insight, source: { type: "research", uri: "research-pm-writing-summary.md" } } });
  svc.approve([prop.id], "Don Richard");
  assert.ok(svc.getNode(p5.id).evidence.some((e: any) => e.quote === insight));
  assert.match(svc.changelog(id)[0].changelog[0].summary, /Added evidence/);
});

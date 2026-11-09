import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.ts";
import { Service } from "./service.ts";

export function buildMcp(svc: Service, defaultActor = process.env.WM_ACTOR ?? "mcp-agent") {
  const server = new McpServer({ name: "world-model", version: "0.1.0" });
  const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
  const fail = (e: any) => ({ isError: true, content: [{ type: "text" as const, text: String(e.message ?? e) }] });
  const modelOf = (id?: string) => {
    if (id) return id;
    const first = svc.listModels()[0] as any;
    if (!first) throw new Error("No world models exist yet. Create one in the web app first.");
    return first.id as string;
  };
  const guard = <A,>(fn: (a: A) => unknown) => (a: A) => { try { return text(fn(a)); } catch (e) { return fail(e); } };
  const model_id = z.string().optional().describe("Model id; defaults to the first model");
  const actor = z.string().optional().describe("Name shown in the changelog for this change");

  server.tool("get_world_model", "Read the whole world model (users, outcomes, problems, features, metrics, health) as markdown or JSON.",
    { model_id, format: z.enum(["md", "json"]).optional() },
    guard(({ model_id, format }) => svc.exportModel(modelOf(model_id), format ?? "md")));

  server.tool("search_world_model", "Given a task, return the relevant subgraph, supporting evidence and a short narrative summary. Call this before starting product work.",
    { task: z.string().describe("What you are about to do, e.g. 'draft a PRD section for success metrics'"), model_id },
    guard(({ task, model_id }) => svc.query(modelOf(model_id), task)));

  server.tool("get_node", "Get one node with its evidence, relationships and change history.", { node_id: z.string() }, guard(({ node_id }) => svc.getNode(node_id)));

  server.tool("trace_feature", "Trace a feature (or any node) to its full path: users, outcomes, problems and metrics. For a metric, shows everything feeding it.",
    { node_id: z.string() }, guard(({ node_id }) => svc.trace(node_id)));

  server.tool("propose_update", "Propose a change to the model. Nothing changes until the owner approves. change_type: add (payload {kind:'node',node:{type,title,description}}), update ({node_id,fields}), link ({from_id,to_id,type}), flag ({node_id,flag,note}).",
    { change_type: z.enum(["add", "update", "link", "flag"]), payload: z.record(z.any()), rationale: z.string().describe("Why this change should be made"), source: z.object({ type: z.string().optional(), uri: z.string().optional(), quote: z.string().optional() }).optional(), model_id, actor },
    guard(({ change_type, payload, rationale, source, model_id, actor: a }) => svc.createProposal(modelOf(model_id), { actor: a ?? defaultActor, actor_type: "agent", change_type, payload, rationale, source_ref: source })));

  server.tool("add_evidence", "Propose new evidence (a verbatim quote or data point) for one or more nodes. Goes to the review queue with provenance.",
    { node_ids: z.array(z.string()).min(1), quote: z.string(), source_uri: z.string().describe("Where the quote came from: file, URL or thread"), source_type: z.string().optional(), source_date: z.string().optional().describe("ISO date of the source"), stance: z.enum(["supports", "contradicts"]).optional(), rationale: z.string().optional(), model_id, actor },
    guard(({ node_ids, quote, source_uri, source_type, source_date, stance, rationale, model_id, actor: a }) => svc.createProposal(modelOf(model_id), {
      actor: a ?? defaultActor, actor_type: "agent", change_type: "add", rationale: rationale ?? "New evidence",
      payload: { kind: "evidence", node_ids, quote, stance: stance ?? "supports", source: { type: source_type ?? "agent_note", uri: source_uri, label: source_uri, date: source_date }, source_date },
      source_ref: { uri: source_uri, quote },
    })));

  server.tool("flag_conflict", "Flag that a node conflicts with something you read. Optionally include the contradicting quote as evidence.",
    { node_id: z.string(), note: z.string().describe("What conflicts and why"), contradicting_quote: z.string().optional(), source_uri: z.string().optional(), model_id, actor },
    guard(({ node_id, note, contradicting_quote, source_uri, model_id, actor: a }) => {
      const mid = modelOf(model_id);
      return svc.createProposal(mid, {
        actor: a ?? defaultActor, actor_type: "agent", change_type: "flag", rationale: note,
        payload: { node_id, flag: "conflict", note, evidence: contradicting_quote ? { quote: contradicting_quote, source: { type: "agent_note", uri: source_uri ?? "", label: source_uri ?? "" } } : undefined },
        source_ref: { uri: source_uri, quote: contradicting_quote },
      });
    }));

  server.tool("list_world_models", "List available world models.", {}, guard(() => svc.listModels()));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const svc = new Service(openDb());
  await buildMcp(svc).connect(new StdioServerTransport());
}

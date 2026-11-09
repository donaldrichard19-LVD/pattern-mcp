# Product World Model (prototype)

A living, typed graph of a product area (users → outcomes → problems → features → metrics), built from the documents a team already writes, shown as an explorable map, and readable and writable by humans and AI agents. This implements the prototype scope of the PRD (draft v0.1).

Target area for the demo: **PRDs, product briefs and other written PM artifacts**. Granola and Zoom AI are ingested as **research inputs** (evidence tagged `research_input`), never modeled as nodes.

## Quick start

Requires Node 22.13+.

```bash
cd world-model
npm install
npm run seed            # demo model from demo/sources (offline, no API key needed)
npm start               # http://127.0.0.1:3737
npm run demo:agent      # an external "agent" reads context and writes back a proposal over REST
npm test                # 20 tests: service, REST, MCP, end-to-end demo loop
```

You can also click **Load the demo** on an empty install, or **New model** and upload your own files on the Sources tab.

## The demo loop (PRD §11)

1. `npm run seed`, then open the app. The map shows 2 users, 5 outcomes, 5 problems, 6 features, 4 metrics, 2 assumptions and a decision. Granola and Zoom AI quotes appear as evidence on the "AI meeting notes are unstructured" problem and the "turn meeting conversations into written artifacts" outcome.
2. `npm run demo:agent` asks the model for context for *"draft a PRD section for the success metrics of a new feature"*, notices a research finding the model lacks, and submits it as a proposal.
3. Open **Review queue**, approve it. The model moves to v7 and the **Changelog** records who, when, and the diff.
4. **Health** shows what the seed deliberately leaves flagged: two orphan features (Decision log sidebar, Dark mode editor), one outcome gap, one stale node, one contradiction, and 80% coverage.

## What is built (PRD P0 unless noted)

| Area | Status |
|---|---|
| Ingestion: .md, .txt, .pdf, .docx, pasted text, Slack export JSON | Yes |
| LLM extraction to the schema with source spans (Claude, forced structured output) | Yes. Set `ANTHROPIC_API_KEY`. Model via `WM_MODEL` (default `claude-sonnet-5-5`) |
| Offline extraction (no key) | Curated outputs for the demo files, plus a "Outcome: …" tagged-line reader for anything else |
| Quote verification | Every quote is located in the source (whitespace-tolerant). Quotes that are not found are dropped and the node gets `low` confidence |
| Layered interactive map, detail panel with evidence and "view in source" highlight, filters (segment, metric, status, health) | Yes |
| Trace mode (feature → its path; metric → everything feeding it) (P1) | Yes |
| REST read API + `query?task=` | Yes |
| MCP server: `get_world_model`, `search_world_model`, `get_node`, `trace_feature`, `propose_update`, `add_evidence`, `flag_conflict` | Yes |
| Write-back with review queue, approve / edit / reject, versioned changelog with actor and diff | Yes |
| Orphan and gap detection | Yes |
| Staleness, contradictions, coverage score (P1) | Yes |
| Conflict detection on proposals (duplicates, contradicting evidence, repeated links) (P1) | Yes |
| Incremental re-ingestion that merges into existing nodes (P1) | Yes (title similarity) |
| Auto-approve for low-risk evidence (P1) | `WM_AUTO_APPROVE=evidence` (agent evidence on existing nodes, never contradictions) |
| Markdown/JSON export for agents without API access (P1), one-page POV view (P2), changelog time window | Yes |
| Live Slack/Drive/Notion connectors (P1), transcripts/survey CSV (P2), rollback | Not built |

## Use it from an agent

**MCP (Claude Code, etc.):**

```bash
claude mcp add world-model -- npm run --silent --prefix /path/to/world-model mcp
# optional: WM_ACTOR=my-agent WM_DB=/path/to/data/world-model.db
```

The MCP server opens the same SQLite file as the web app, so write-backs appear in the review queue.

**REST:**

```bash
curl "localhost:3737/models/$ID/query?task=draft%20a%20PRD%20section%20for%20success%20metrics"
curl -XPOST localhost:3737/models/$ID/proposals -H 'x-actor: my-agent' -H 'content-type: application/json' -d '{
  "change_type":"add","rationale":"Found in call notes",
  "payload":{"kind":"evidence","node_ids":["<node id>"],"quote":"…","source":{"type":"note","uri":"call-2026-11-03.md"}}}'
```

Endpoints: `GET /models`, `POST /models`, `GET /models/:id`, `GET /models/:id/query?task=`, `GET /models/:id/health`, `GET /models/:id/changelog`, `GET /models/:id/export?format=md|json`, `GET|POST /models/:id/sources`, `GET /sources/:id`, `GET /nodes/:id`, `GET /nodes/:id/trace`, `GET|POST /models/:id/proposals`, `POST /proposals/approve|reject`, `POST /nodes/:id/resolve-flag`.

Proposal `change_type` payloads: `add` (`{kind:"node",node:{type,title,description,status}}` or `{kind:"evidence",node_ids,quote,stance,source}`), `update` (`{node_id,fields}`), `link` (`{from_id,to_id,type}`), `flag` (`{node_id,flag,note}`). Edge types and which node types they connect are validated at submission (`wants`, `blocked_by`, `addresses`, `moves`, `affects`).

## Design notes

- **Storage:** SQLite via Node's built-in `node:sqlite` (experimental in Node 22, no native build). Tables: models, sources, nodes, edges, evidence, proposals, versions. Default file `data/world-model.db` (`WM_DB` to change).
- **Evidence is a table, not a node type.** It attaches to one or more nodes with a `supports` / `contradicts` stance, source, span offsets and date. That matches the PRD's data-model sketch and keeps the map readable.
- **One version per approval action.** Approving a group creates one version, applied atomically (all or nothing). Every entry records actor, actor type, time, and a before/after diff.
- **Health rules (§5):** a feature is an orphan unless it reaches an outcome (directly or through a problem) *and* moves a metric. An outcome is a gap if no feature reaches it. Coverage = outcomes with at least one feature and one metric.
- **Frontend:** a single dependency-free `public/index.html` with an HTML/SVG layered layout, rather than React Flow, to keep the prototype installable with no build step. Swap in React Flow if you need pan/zoom and large graphs.
- **Query summary** is deterministic (templated from the retrieved subgraph); retrieval is keyword scoring plus graph expansion, not embeddings.

## Security and privacy

Prototype, single user. The server binds to `127.0.0.1`. Set `WM_OWNER_TOKEN` to require a bearer token for approving, rejecting, ingesting and creating models (the UI prompts for it), and `WM_API_TOKEN` to require one for reads and proposals. There are no per-user roles beyond that. Source text, including any Slack or research data, is stored unencrypted in the local SQLite file; and when `ANTHROPIC_API_KEY` is set, document text is sent to the Claude API for extraction. Demo sources are synthetic; the Granola and Zoom AI excerpts are illustrative samples written for the demo, **not real reviews**. Replace them with real review or interview material before drawing conclusions about those products.

## Known limits

- Extraction quality with a real LLM is untested here (no API key in the build environment). Only the pipeline, quote verification and offline path are covered by tests.
- Duplicate detection is title-token similarity, so paraphrased duplicates still need a human to merge.
- Source dates in the demo are relative to the seed time, so staleness stays illustrative.
- No rollback to a previous version yet; the changelog diffs contain what is needed to build it.

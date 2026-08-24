# ui-component-judgment-mcp

MCP server exposing one tool, `recommend_component`, that judges whether a UI
component need should be met with an existing shadcn/ui or 21st.dev
component, or requires a custom build guided by a real-app reference from
Mobbin. Returns a structured verdict, not a list of search results — built
for an agent to consume mid-build, not for a human to browse.

This implements the judgment layer validated in the product brief: field/
requirement coverage scored against real component evidence, thresholded
into `use_existing` / `custom_build`, with a `no_candidates_found` bucket
kept distinct from low coverage, a static skip-list for trivial primitives,
and a `computed_at` timestamp since coverage is a snapshot, not a permanent
fact.

## How it works

The server does not scrape shadcn/21st.dev/Mobbin itself. Each tool call
makes one request to the Anthropic Messages API (`claude-sonnet-4-6`) with
the server-side `web_search` tool enabled, and a system prompt that encodes
the full process: skip-list check, requirement extraction, candidate search,
real-evidence coverage scoring, threshold, and — on `custom_build` — a
Mobbin reference lookup. The model returns structured JSON, which the server
passes back to the calling agent unchanged.

Trivial primitives (button, input, checkbox, label, badge, spinner, tooltip,
avatar, icon) are caught locally before any API call, so they don't spend a
request.

## Setup

```bash
npm install
npm run build
```

Requires `ANTHROPIC_API_KEY` set in the environment the server runs in.

## Running

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

This starts an MCP server over stdio. Point your MCP client (Claude Code,
Cursor, Claude Desktop, etc.) at it — the exact config depends on the
client, but generally looks like:

```json
{
  "mcpServers": {
    "ui-component-judgment": {
      "command": "node",
      "args": ["/path/to/ui-component-mcp/dist/index.js"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

## Tool: `recommend_component`

**Input:**
```json
{
  "component_need": "price breakdown with fees and taxes",
  "domain": "Airbnb-style rental marketplace",
  "framework": "React + Tailwind",
  "existing_stack": "already using shadcn/ui"
}
```
`component_need` should be specific, not a category — "price breakdown with
fees and taxes" not "pricing". Vague category names are what produced
false-positive matches during validation (a generic SaaS pricing-tier
component scoring as a match for a booking checkout).

**Output:** JSON matching:
```json
{
  "verdict": "use_existing | custom_build",
  "confidence": "high | medium | low",
  "reason": "scored | no_candidates_found | skip_list",
  "computed_at": "2026-08-23",
  "requirements_checked": [ { "requirement": "...", "met": true, "evidence": "..." } ],
  "coverage": "5/7 (71%)",
  "recommendation": {
    "source": "21st.dev | shadcn | null",
    "install_command": "string | null",
    "reference": { "source": "Mobbin", "url": "...", "flow_name": "..." }
  }
}
```

## Cost

Each non-trivial call runs a short multi-turn tool loop (search → score →
respond), which costs roughly $0.06–$0.10 with Sonnet 5 at current pricing
($2/M input, $10/M output, $0.01 per web_search call) — skip-listed
primitives cost $0 since they never reach the API. Three things keep this
down without touching quality:

- **Prompt caching** on the system block (`cache_control: ephemeral`) —
  the instructions are identical every call, so repeated turns and repeated
  invocations read from cache instead of re-billing full price.
- **A 2-search budget** for candidate discovery (1 more if `custom_build`
  triggers a Mobbin lookup), with shadcn and 21st.dev searched in the same
  turn rather than sequentially, so the growing conversation gets re-sent
  fewer times per call.
- **`UI_JUDGMENT_MODEL` env var** (defaults to `claude-sonnet-5`) — lets you
  swap in a cheaper model (e.g. Haiku 4.5) without a code change. Before
  trusting a cheaper model in production, re-run the 5 validated test cases
  from the product brief (price breakdown, cancellation policy, earnings
  dashboard, gallery, messaging) and diff the verdicts against Sonnet's —
  this hasn't been tested, only reasoned about.

## Known limitations (carried over from validation)

- **No caching, by design.** Every call re-searches and re-scores from
  scratch. A `custom_build` verdict can go stale as libraries ship new
  components (validated: shadcn's June 2026 chat primitives turned a likely
  custom-build messaging component into a near-perfect match). If you add
  caching at the calling-agent layer, keep it session-scoped only — never
  persist a verdict across sessions or builds.
- **Skip-list is a starting point, not validated against real usage yet.**
  Log every call and whether it hit the skip-list; watch for agents calling
  the tool anyway on skip-listed items (list too narrow) or shipping generic
  UI for something that should've been skipped (list missing an entry).
- **Not testable end-to-end in a fully sandboxed environment.** This server
  needs outbound network access to `api.anthropic.com` plus whatever the
  model's web_search tool reaches — it won't run somewhere that blocks
  general internet access.
- **Requirement extraction and coverage scoring are judgment calls made by
  the model in a single pass**, not deterministic lookups. Spot-check early
  outputs against real components before trusting the pipeline unattended,
  same as during manual validation.

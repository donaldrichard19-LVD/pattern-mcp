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
makes one or more requests to the Anthropic Messages API (`claude-sonnet-5`
by default) with the server-side `web_search` tool enabled, and a system
prompt that encodes the full process: skip-list check, requirement
extraction, candidate search, real-evidence coverage scoring, threshold, and
— on `custom_build` — a Mobbin reference lookup. The model returns
structured JSON; the server recomputes the coverage fraction from the
`requirements_checked` array itself (rather than trusting the model's stated
percentage) and applies the verdict/confidence threshold in code.

**Boundary-risk ensemble.** Validation found that a single run's coverage
score can vary between calls on the same input — not because search results
differ, but because the model can judge the same piece of evidence
differently run to run (see Known limitations). When a call's recounted
coverage lands close enough to a threshold boundary to plausibly flip the
verdict, the server automatically re-runs the judgment 2 more times and
takes the majority verdict. If the 3 runs disagree (a 2/3 split), the result
ships with `confidence: "low"` and an `ensemble` field so the calling agent
can see it was a close call rather than a confident read. Calls that land
clearly inside a threshold band never trigger this and stay single-run —
see [Cost](#cost) below for the measured impact.

Trivial primitives (button, input, checkbox, label, badge, spinner, tooltip,
avatar, icon) are caught locally before any API call, so they don't spend a
request.

## Setup — quickstart

```bash
git clone <this repo>
cd ui-component-judgment-mcp
npm install
npm run build
```

Requires `ANTHROPIC_API_KEY` — the account whose key you use pays for every
call this tool makes (see [Cost](#cost) below).

**Point your MCP client at it** — this is a standard MCP server, so it works
with any MCP-compatible client, not just one. Drop this into your client's
config (adjusting the path per client), swapping in your own project path
and key:

- Claude Code: `.claude/mcp_config.json`, or `claude mcp add`
- Cursor: `.cursor/mcp.json`
- Codex CLI: `~/.codex/config.toml` (global) or `.codex/config.json`
  (project-level) — same `mcpServers` shape, TOML or JSON depending on file
- Claude Desktop: its MCP settings file

```json
{
  "mcpServers": {
    "ui-component-judgment": {
      "command": "node",
      "args": ["/absolute/path/to/ui-component-judgment-mcp/dist/index.js"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

Restart your MCP client, then confirm it picked up the tool — ask your
agent to list its available MCP tools and look for `recommend_component`.

## Try it

Ask your agent something like: *"Use recommend_component to find me a UI
component for a price breakdown showing nightly rate, cleaning fee, service
fee, and taxes — I'm building an Airbnb-style booking checkout in React with
Tailwind."* The agent should call the tool and act on the verdict directly
(install a real component, or start from the returned checklist and Mobbin
reference) rather than just describing what it found.

**What you'll actually see:** both verdict paths now include a written,
grounded description, not just a bare link or install command. A
`use_existing` verdict includes `component_description` — what the
recommended component actually does and looks like, described before the
agent installs anything. A `custom_build` verdict includes
`reference_description` — what the Mobbin reference screen shows. Either
way, testers get a specific, readable description grounded in what the
model actually found during search, not generic filler.

If you want to sanity-check the tool itself rather than a real feature,
these five needs are the ones this project's own validation was built
against, spanning the full range of outcomes (clean commodity match,
false-positive-prone case, zero candidates, and boundary/near-tie cases):
price breakdown with fees and taxes, cancellation policy display, host
earnings dashboard, image gallery for a property listing, and a host-guest
messaging inbox — all in the same Airbnb-style rental marketplace domain.

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
    "component_description": "string (use_existing only) | null",
    "reference": { "source": "Mobbin", "url": "...", "flow_name": "...", "reference_description": "..." }
  },
  "ensemble": { "triggered": false }
}
```
`ensemble.triggered` is `false` on the normal single-pass path. On a
boundary-risk coverage result it becomes
`{ "triggered": true, "runs": ["use_existing", "custom_build", "use_existing"], "agreement": "2/3" }`
— see [Ensemble cost](#ensemble-cost-boundary-risk-cases-only) below.

## Cost

A single pass (search → score → respond) costs roughly $0.06–$0.10 with
Sonnet 5 at current pricing ($2/M input, $10/M output, $0.01 per
web_search call) — skip-listed primitives cost $0 since they never reach
the API. Three things keep a single pass down without touching quality:

- **Prompt caching** on the system block (`cache_control: ephemeral`) —
  the instructions are identical every call, so repeated turns and repeated
  invocations read from cache instead of re-billing full price.
- **A 2-search budget** for candidate discovery, plus 1 more reserved
  specifically for the `custom_build` Mobbin lookup so it doesn't have to
  compete with discovery for the same cap — shadcn and 21st.dev are
  searched in the same turn rather than sequentially, so the growing
  conversation gets re-sent fewer times per call.
- **`UI_JUDGMENT_MODEL` env var** (defaults to `claude-sonnet-5`) — lets you
  swap in a cheaper model (e.g. Haiku 4.5) without a code change. Before
  trusting a cheaper model in production, re-run the 5 validated test cases
  from the product brief (price breakdown, cancellation policy, earnings
  dashboard, gallery, messaging) and diff the verdicts against Sonnet's —
  this hasn't been tested, only reasoned about.

### Ensemble cost (boundary-risk cases only)

Testing found that a single pass isn't reliable near the verdict
thresholds: with the requirement checklist fixed at exactly 8 items,
coverage can only land on one of 9 discrete values (0, 12.5, 25, 37.5,
50, 62.5, 75, 87.5, 100%), and the 40%/80% thresholds sit *between* two
of those values (37.5↔50, and 75↔87.5). For met-counts of 3, 4, 6, or 7,
a single item's met/unmet judgment flipping is enough to change the
verdict — and it does, run to run, on identical input.

To catch that, the server runs a **targeted ensemble**: every pass still
runs once as normal, but if the result lands on one of those four risky
met-counts (`isBoundaryRisk` in `src/index.ts`), it triggers 2 additional
full passes (3 total) and takes the majority verdict. Confidence is
forced to `"low"` on a genuine 2/3 split, regardless of what any
individual pass reported — a real disagreement across identical inputs
is uncertainty the tool should surface, not paper over. Everything else
(0, 1, 2, 5, 8 met — far enough from both thresholds that a 1-item swing
can't flip the verdict) returns the single pass as-is, at 1x cost. An
earlier version also triggered on `reason: "no_candidates_found"`
(a separate source of run-to-run inconsistency); that trigger was removed
after testing showed it never actually changed a verdict in this
session and was pure added cost.

The output includes an `ensemble` field so callers can see whether this
happened: `{ "triggered": false }` on the fast path, or
`{ "triggered": true, "runs": ["use_existing", "custom_build", "use_existing"], "agreement": "2/3" }`
when it fired.

**Measured cost, not just worst case:** across the last 5-case × 3-run
test batch (15 outer calls), 8 stayed single-run and 7 triggered the
ensemble (21 calls), for **29 total API calls — a ~1.9x blended average
multiplier**, not the 3x a naive "ensemble triggered" framing implies.
Worst case is still 3x per call when it triggers; most calls don't.

Ensembling does *not* fully eliminate the underlying variance for the
hardest cases. When a case's true coverage sits close enough to a
threshold that per-item judgment is close to a coin flip, majority-of-3
is a noisy estimator: it protects any single call against one unlucky
draw, but a *different* set of 3 draws on the next invocation can still
land on the other side. One case (image gallery) kept flipping across
outer runs even with the ensemble active, always with a 2/3 split and
`confidence: "low"` — the tool is correctly reporting low confidence on
a genuinely ambiguous case rather than a bug to fix with a bigger N.

## Known limitations (carried over from validation)

- **Evidence judgment varies run to run, independent of search results.**
  Validation traced a real case where two runs found the exact same named
  candidate components via the exact same search queries, but the model
  judged the same evidence differently — e.g. reading one candidate's
  "Export" action as present in one run and absent in another, for the
  identical component. This isn't a search-consistency or code bug; it's
  inherent to how the model reads natural-language evidence, and it's what
  the boundary-risk ensemble exists to catch and disclose (as a 2/3
  `agreement` split) rather than eliminate. If you see a verdict flip
  between your own runs on the same input, this is almost certainly why.
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
  the model**, not deterministic lookups, even with the ensemble and
  server-side recount in place. Spot-check early outputs against real
  components before trusting the pipeline unattended.

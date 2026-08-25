# ui-component-judgment-mcp

MCP server exposing two tools. `recommend_component` judges whether a UI
component need should be met with an existing shadcn/ui or 21st.dev
component, or requires a custom build guided by a real-app reference from
Mobbin and/or Figma Community. Returns a structured verdict, not a list of
search results — built for an agent to consume mid-build, not for a human
to browse. `record_component_decision` records a decision the calling agent
has actually acted on, so a later `recommend_component` call in the same
project can weigh it as a consistency signal — see
[Per-project decision memory](#per-project-decision-memory).

This implements the judgment layer validated in the product brief: field/
requirement coverage scored against real component evidence, thresholded
into `use_existing` / `custom_build`, with a `no_candidates_found` bucket
kept distinct from low coverage, a static skip-list for trivial primitives,
and a `computed_at` timestamp since coverage is a snapshot, not a permanent
fact.

## How it works

The server does not scrape shadcn/21st.dev/Mobbin/Figma itself. Each tool
call makes one or more requests to the Anthropic Messages API
(`claude-sonnet-5` by default) with the server-side `web_search` tool
enabled, and a system prompt that encodes the full process: skip-list
check, requirement extraction, candidate search, real-evidence coverage
scoring, threshold, and — on `custom_build` — reference lookups against
Mobbin and Figma Community. No new credentials are required for the Figma
lookup — it uses the same plain `web_search` mechanism as everything else
in the tool, not the Figma API. The model returns structured JSON; the
server recomputes the coverage fraction from the `requirements_checked`
array itself (rather than trusting the model's stated percentage) and
applies the verdict/confidence threshold in code.

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
call this tool makes (see [Cost](#cost) below). Get one from the
[Anthropic Console](https://console.anthropic.com) (Settings → API Keys);
this requires its own billing setup. **This is not the same thing as a
Claude.ai or Claude Code subscription** — a Pro/Max plan does not cover
API usage, and a subscription login won't get you a key. You need a
separate Console account with credits or a payment method attached.

**Point your MCP client at it** — this is a standard MCP server, so it works
with any MCP-compatible client, not just one. Drop this into your client's
config (adjusting the path per client), swapping in your own project path
and key:

- **Claude Code**: either add `"ui-component-judgment": { ... }` (the
  block below) to the `mcpServers` object in `.mcp.json` at your project
  root, or run:
  ```bash
  claude mcp add ui-component-judgment \
    -e ANTHROPIC_API_KEY=sk-ant-... \
    -- node /absolute/path/to/ui-component-judgment-mcp/dist/index.js
  ```
  This registers under `--scope local` (the default) — tied to the
  current project directory only. Add `--scope user` (or `-s user`)
  instead to make it available across **all** your projects:
  ```bash
  claude mcp add ui-component-judgment \
    -e ANTHROPIC_API_KEY=sk-ant-... \
    --scope user \
    -- node /absolute/path/to/ui-component-judgment-mcp/dist/index.js
  ```
  **Flag order matters here.** `-e`/`--env` and `-s`/`--scope` must come
  *before* the `--` separator and command — `claude mcp add`'s
  `[args...]` capture is variadic, so a flag placed *after* the command
  (e.g. `node dist/index.js --scope user`) is liable to be swallowed as
  an argument to `node` itself instead of being parsed as a flag for
  `claude mcp add`. Keep all your flags on the left of `--`, the command
  and its own args on the right.

  `claude mcp add` stores this in `~/.claude.json` (a local- or
  user-scoped entry depending on `--scope`), not in a project file —
  check with `claude mcp list` (should show
  `ui-component-judgment ... ✔ Connected`). Avoid `claude mcp get
  ui-component-judgment` if you can — it prints your key back to the
  terminal in plaintext, so `claude mcp list`'s connection status is
  usually enough without that risk.
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
For Claude Code specifically, `claude mcp list` will show a health-checked
`✔ Connected` status without needing to ask the agent directly.

## Try it

Ask your agent something like: *"Use recommend_component to find me a UI
component for a price breakdown showing nightly rate, cleaning fee, service
fee, and taxes — I'm building an Airbnb-style booking checkout in React with
Tailwind."* The agent should call the tool and act on the verdict directly
(install a real component, or start from the returned checklist and
Mobbin/Figma Community reference) rather than just describing what it
found.

**What you'll actually see:** both verdict paths now include a written,
grounded description, not just a bare link or install command. A
`use_existing` verdict includes `component_description` — what the
recommended component actually does and looks like, described before the
agent installs anything. A `custom_build` verdict includes
`reference_description` for each reference it found — what that Mobbin
screen or Figma Community file actually shows. Either way, testers get a
specific, readable description grounded in what the model actually found
during search, not generic filler.

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
  "existing_stack": "already using shadcn/ui",
  "project_id": "my-booking-app"
}
```
`component_need` should be specific, not a category — "price breakdown with
fees and taxes" not "pricing". Vague category names are what produced
false-positive matches during validation (a generic SaaS pricing-tier
component scoring as a match for a booking checkout).

`project_id` is optional — a project name or path the calling agent
supplies. When present, past decisions recorded for that same `project_id`
via `record_component_decision` are pulled from
[per-project decision memory](#per-project-decision-memory) and included in
the prompt as a *signal, not a rule*: the model is instructed to weigh
consistency with a highly similar past decision, but never to let it
override a genuinely better match this search finds, and never to skip
searching or scoring because a past decision exists. Coverage is still
computed fresh on every call regardless — see
[No caching, by design](#known-limitations-carried-over-from-validation).
Omit `project_id` to skip memory entirely; there's no shared/global bucket
it falls back to.

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
    "reference": {
      "source": "Mobbin | Figma Community",
      "url": "...",
      "flow_name": "... (Mobbin only)",
      "file_name": "... (Figma Community only)",
      "reference_description": "...",
      "url_type": "deep_link | entry_point"
    }
  },
  "ensemble": { "triggered": false },
  "past_decision_signal": { "considered": true, "note": "..." }
}
```
`ensemble.triggered` is `false` on the normal single-pass path. On a
boundary-risk coverage result it becomes
`{ "triggered": true, "runs": ["use_existing", "custom_build", "use_existing"], "agreement": "2/3" }`
— see [Ensemble cost](#ensemble-cost-boundary-risk-cases-only) below.

`past_decision_signal` only appears when `project_id` was provided **and**
that project has at least one past decision recorded — omitted entirely
otherwise, never a hollow `{ "considered": false }` on a call with nothing
to consider. `considered` is `true` only when a past decision was
genuinely similar enough to factor into scoring or recommendation, not
just present in the list; `note` names which decision and how, or why none
applied. This is enforced server-side, not just prompted: a
`considered`/`note` pair the model returns on a call that had no
past-decision context in its prompt is discarded rather than trusted — see
[Per-project decision memory](#per-project-decision-memory).

**`recommendation.reference` shape depends on how many sources actually
grounded**, not just on the verdict. On a `custom_build` verdict:
- Both Mobbin and Figma Community returned a real, grounded result:
  `reference` is an **array of both** objects.
- Only one of the two grounded: `reference` is a **single object**, same
  shape as before this feature existed — never a one-element array.
- Neither grounded: `reference` is `null`, same as today's
  no-fabrication rule for a Mobbin-only lookup that found nothing.

No new credentials are required for the Figma Community reference — it
uses the same `web_search` mechanism as every other lookup in this tool,
not the Figma API, so there's no separate token to configure.

**`reference.url_type` tells you whether the URL is a deep link or just a
search entry point.** A Mobbin or Figma Community search result is very
often a category/browse page (e.g.
`mobbin.com/explore/mobile/screens/notifications`), not a direct link to
the specific screen or flow the model actually identified (e.g. "Saturn
Calendar - Notifications List") — the original gap this field exists to
disclose. On a `custom_build` verdict:

- **Mobbin**: the server fetches the search result page (via the
  `web_fetch` tool) and looks for a more specific permalink to the
  identified screen/flow actually written on that page. Found and
  confirmed → `url_type: "deep_link"` and `url` is that permalink. Not
  found (including when the fetch itself fails) → `url_type:
  "entry_point"`, `url` stays the category/search page, and
  `reference_description` is guaranteed to say so explicitly (append or
  auto-generated server-side, never left to the model alone) — so a
  reader always knows whether they're getting the exact screen or a
  browse page they'll need to search themselves.
- **Figma Community**: a result URL containing `/community/file/` is
  already file-specific by Figma's own URL structure, so it's treated as
  `url_type: "deep_link"` without spending a fetch on it. A result that
  *isn't* a `/community/file/` URL (an occasional browse/tag page) goes
  through the same fetch-and-verify path as Mobbin. In practice a Figma
  fetch will almost always fail regardless — `figma.com/robots.txt`
  disallows `ClaudeBot` site-wide — so a non-file Figma result reliably
  ends up `entry_point`, honestly.

This is enforced the same way as every other grounding rule in this
project: **server-side, not just prompt instruction.** A claimed deep
link is only kept if it's literally present in the text of a page the
server actually fetched; a claim that fails that check is silently
replaced with a real URL from an actual search/fetch result (never
discarded to a guess), and the entry-point caveat is force-appended to
`reference_description` if the model's own text didn't already disclose
it. `src/index.ts`'s `applyDeepLinkGrounding` is the single place this
happens — see its comments for the exact rules, including why a
model-guessed URL-pattern retry (e.g. stripping a path segment after a
fetch fails) is both prompted against and independently rejected by the
`web_fetch` tool itself (`url_not_in_prior_context`).

**`install_command` is untrusted text.** It's derived from a web search
result the model read, not a verified package registry, and the server
does not execute or validate it. The calling agent is instructed (in the
tool description and system prompt) to always display it to the user for
confirmation before running it, and never execute it automatically or
silently — this is expected agent behavior this project depends on, not
something the server enforces. See [SECURITY.md](./SECURITY.md).

## Tool: `record_component_decision`

Records a decision the calling agent has actually acted on — call it
**after** installing an existing component or finishing a custom build, not
on every `recommend_component` verdict returned. Its only job is appending
one entry to local [per-project decision memory](#per-project-decision-memory);
it runs no judgment logic and makes no Anthropic API call, so it's
effectively free and instant.

**Input:**
```json
{
  "project_id": "my-booking-app",
  "component_need": "price breakdown with fees and taxes",
  "domain": "Airbnb-style rental marketplace",
  "action": "custom_built",
  "source": "custom",
  "timestamp": "2026-08-25T14:32:00.000Z"
}
```
- `project_id` (required) — must match the `project_id` you pass to
  `recommend_component` for this decision to ever be surfaced there. Use a
  stable value, e.g. the project's directory path or name.
- `component_need` (required), `domain` (optional) — same fields as
  `recommend_component`'s input; free text, not matched against anything
  server-side.
- `action` (required) — `"installed"` or `"custom_built"`.
- `source` (required) — e.g. `"shadcn"`, `"21st.dev"`, or `"custom"` for a
  custom build.
- `timestamp` (optional) — ISO 8601; defaults to the current time if
  omitted.

**Output:**
```json
{ "status": "recorded", "project_id": "my-booking-app", "entry": { "...": "..." } }
```

## Per-project decision memory

`record_component_decision` appends to a local JSON file, default path
`~/.ui-component-judgment-mcp/memory.json`, overridable via
`UI_JUDGMENT_MEMORY_PATH` — same override pattern as
[`UI_JUDGMENT_LOG_PATH`](#local-call-log). It's a flat object keyed by
`project_id`, each value an array of decision entries in the same shape as
`record_component_decision`'s input (minus `project_id` itself, since
that's the key):

```json
{
  "my-booking-app": [
    {
      "component_need": "price breakdown with fees and taxes",
      "domain": "Airbnb-style rental marketplace",
      "action": "custom_built",
      "source": "custom",
      "timestamp": "2026-08-25T14:32:00.000Z"
    }
  ]
}
```

Each project's array is capped at the **50 most recent entries** — once a
project hits the cap, the oldest entry is dropped as a new one is added, so
the file stays bounded for a long-lived project without manual cleanup.

**Only explicitly confirmed decisions are stored here — not every verdict
`recommend_component` returns.** The server never writes to this file on
its own; `recommend_component` only ever *reads* it (when `project_id` is
provided) and never writes to it. A verdict you don't act on, or act on
differently than recommended, leaves no trace here unless you call
`record_component_decision` yourself to say what you actually did.

**This is local-only plaintext**, same caveat pattern as the
[local call log](#local-call-log): nothing in this file is sent anywhere by
this server. `component_need` and `domain` are written here the same way
they're written to `calls.log` — see
[SECURITY.md](./SECURITY.md#what-actually-leaves-your-machine) before
putting anything sensitive in those fields. A write failure (disk full,
read-only filesystem, permissions) surfaces as a tool error on
`record_component_decision` itself, since — unlike the best-effort call
log — writing the decision *is* that tool's entire job, not a side effect
of it.

**This does not weaken the no-verdict-caching rule.** Memory only ever adds
past-decision context to the prompt for a fresh judgment pass — see
[No caching, by design](#known-limitations-carried-over-from-validation)
and the `project_id` note under
[Tool: `recommend_component`](#tool-recommend_component). Coverage is
recomputed from a real search every single call, with or without a
`project_id`.

## Cost

A single pass (search → score → respond) costs roughly $0.06–$0.10 with
Sonnet 5 at current pricing ($2/M input, $10/M output, $0.01 per
web_search call) — skip-listed primitives cost $0 since they never reach
the API. Three things keep a single pass down without touching quality:

- **Prompt caching** on the system block (`cache_control: ephemeral`) —
  the instructions are identical every call, so repeated turns and repeated
  invocations read from cache instead of re-billing full price.
- **A 2-search budget** for candidate discovery, plus 2 more reserved
  specifically for the `custom_build` reference lookups (one each for
  Mobbin and Figma Community) so neither has to compete with discovery
  for the same cap — shadcn and 21st.dev are searched in the same turn
  rather than sequentially, so the growing conversation gets re-sent
  fewer times per call.
- **A separate 2-call `web_fetch` budget**, used only for the step-6
  deep-link check described above (`max_content_tokens: 15000` caps what
  a single category-page fetch can cost). `web_fetch` itself has no
  per-call charge beyond the tokens the fetched page adds to context, and
  the system prompt explicitly reserves this tool for step 6 only — the
  model is instructed not to reach for it during requirement scoring
  (step 4), so it doesn't compete with the reference lookups it exists
  for.
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

### Session call cap

The server caps itself at **40 calls per process lifetime** by default,
configurable via `UI_JUDGMENT_SESSION_CAP`. This protects against a
*buggy calling agent* looping on the tool — a retry loop, a stuck agent
re-calling the same need repeatedly — not against normal project usage.
The number is grounded in real usage, not arbitrary: a full pass through
a realistic ~25-component project (scaled up from this project's own
5-case Airbnb-style validation list) costs 25 calls, so 40 leaves
headroom for iteration on top of that without being so high it fails to
catch an actual runaway loop before it gets expensive. Skip-listed
primitives don't count toward the cap, since they never reach the API.
The counter is in-memory and resets when the server process restarts —
raise the cap via the env var if 40 is genuinely too low for your
project, don't just restart repeatedly to reset it.

## Local call log

Every call that reaches the API (skip-list hits excluded, same exclusion
as the session cap) appends one JSON line to a local log file — default
path `~/.ui-component-judgment-mcp/calls.log`, overridable via
`UI_JUDGMENT_LOG_PATH`. This is **local-only**: nothing here is sent
anywhere by this server, it's purely for your own debugging/usage
visibility.

Each line looks like:
```json
{"timestamp":"2026-08-24T21:12:43.882Z","component_need":"cancellation policy display","domain":"Airbnb-style rental marketplace","framework":"React + Tailwind","verdict":"custom_build","confidence":"high","reason":"scored","coverage":"2/8 (25%)","ensemble_triggered":false,"reference_sources_grounded":["Mobbin","Figma Community"]}
```
`ensemble_agreement` is only present when `ensemble_triggered` is `true`.
`reference_sources_grounded` is only present on `custom_build` verdicts,
and only lists sources (`"Mobbin"`, `"Figma Community"`) that actually
grounded — matches whatever `recommendation.reference` ended up being
after grounding is enforced (see the
[Tool](#tool-recommend_component) section above for the full shape
rules).

**Deliberately excluded**: full `requirements_checked` evidence text, and
the API key — never written here. **Included in plaintext**:
`component_need` and `domain` — see
[SECURITY.md](./SECURITY.md#what-actually-leaves-your-machine) before
putting anything sensitive in those fields. The log directory is created
automatically if it doesn't exist, and a write failure (disk full,
read-only filesystem, permissions) is caught and reported to stderr —
it never breaks the tool call itself.

**Reviewing a log file** — including a tester's, if they send you
theirs (there's no automatic collection; this project doesn't phone
home): run `node summarize-log.js [path]`, defaulting to the same
location the server itself uses. It prints a verdict/confidence/reason
breakdown, ensemble trigger and agreement rates, reference-source
grounding rates on `custom_build` verdicts, and flags any
`component_need` called more than once — a signal worth checking
against the [session cap](#session-call-cap) if you see it.

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
  persist a verdict across sessions or builds. This still holds with
  [per-project decision memory](#per-project-decision-memory) in the
  picture: memory only ever adds context to the prompt for a fresh
  judgment pass, it never substitutes for one — a `recommend_component`
  call with a `project_id` still always re-searches and re-scores.
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

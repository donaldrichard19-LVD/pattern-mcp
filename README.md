# Pattern

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
cd pattern-mcp
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

- **Claude Code**: either add `"pattern": { ... }` (the
  block below) to the `mcpServers` object in `.mcp.json` at your project
  root, or run:
  ```bash
  claude mcp add pattern \
    -e ANTHROPIC_API_KEY=sk-ant-... \
    -- node /absolute/path/to/pattern-mcp/dist/index.js
  ```
  This registers under `--scope local` (the default) — tied to the
  current project directory only. Add `--scope user` (or `-s user`)
  instead to make it available across **all** your projects:
  ```bash
  claude mcp add pattern \
    -e ANTHROPIC_API_KEY=sk-ant-... \
    --scope user \
    -- node /absolute/path/to/pattern-mcp/dist/index.js
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
  `pattern ... ✔ Connected`). Avoid `claude mcp get
  pattern` if you can — it prints your key back to the
  terminal in plaintext, so `claude mcp list`'s connection status is
  usually enough without that risk.
- Cursor: `.cursor/mcp.json`
- Codex CLI: `~/.codex/config.toml` (global) or `.codex/config.json`
  (project-level) — same `mcpServers` shape, TOML or JSON depending on file
- Claude Desktop: its MCP settings file

```json
{
  "mcpServers": {
    "pattern": {
      "command": "node",
      "args": ["/absolute/path/to/pattern-mcp/dist/index.js"],
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
[No caching, by design](#known-limitations).
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
`~/.pattern/memory.json`, overridable via
`PATTERN_MEMORY_PATH` — same override pattern as
[`PATTERN_LOG_PATH`](#local-call-log). It's a flat object keyed by
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
[No caching, by design](#known-limitations)
and the `project_id` note under
[Tool: `recommend_component`](#tool-recommend_component). Coverage is
recomputed from a real search every single call, with or without a
`project_id`.

## Cost

Pattern uses the Anthropic API, so `recommend_component` has a cost.

A typical single pass costs about $0.06–$0.10 with Sonnet 5 at current
pricing. Skip-listed primitives cost $0 because they're handled locally
and never reach the API.

Three things help keep the cost down without changing the decision process.

### Prompt caching

Pattern caches its system instructions using `cache_control: ephemeral`.

The instructions are the same across calls, so repeated requests don't
pay the full input cost for that block.

### Search limits

Pattern limits candidate discovery to 2 web searches.

If a custom build is needed, it reserves 2 additional searches for
references:

- 1 for Mobbin
- 1 for Figma Community

shadcn/ui and 21st.dev are searched in the same turn rather than
sequentially, which reduces how much conversation context needs to be
sent repeatedly.

### Reference verification

Pattern allows up to 2 `web_fetch` calls, used only to verify reference
URLs.

A fetch can read up to 15,000 content tokens. `web_fetch` has no separate
per-call fee; the cost comes from the content added to the model's
context.

Pattern does not use `web_fetch` during requirement scoring. It's
reserved for verifying reference links.

### Choosing a cheaper model

You can change the model with:

```
PATTERN_MODEL
```

It defaults to:

```
claude-sonnet-5
```

You could use a cheaper model such as Haiku 4.5 without changing the code.

Before using a cheaper model in production, run the five validation cases
and compare its results with Sonnet's:

- Price breakdown
- Cancellation policy
- Earnings dashboard
- Image gallery
- Messaging inbox

The cheaper model hasn't been validated yet, so these results should be
treated as an open question rather than an established performance claim.

### Ensemble cost (boundary-risk cases only)

Pattern uses extra model calls only when a result is close enough to a
decision threshold that a small change in judgment could change the
verdict.

The requirement checklist has eight items, so coverage can only land on
these values:

```
0%
12.5%
25%
37.5%
50%
62.5%
75%
87.5%
100%
```

The decision thresholds are 40% and 80%.

That means results at 37.5%, 50%, 75%, and 87.5% are the cases where
changing the judgment on one requirement can flip the verdict.

For those cases, Pattern runs the full judgment three times and takes
the majority result.

For example:

```json
{
  "ensemble": {
    "triggered": true,
    "runs": ["use_existing", "custom_build", "use_existing"],
    "agreement": "2/3"
  }
}
```

If all three runs agree, the majority verdict is returned normally.

If they split 2/3, Pattern sets confidence to `"low"`. The disagreement
is surfaced rather than hidden.

Results at 0, 12.5, 25, 62.5, and 100% stay single-pass because one
changed requirement can't move them across either threshold.

### Measured ensemble cost

The ensemble doesn't mean every call costs 3x.

In the latest five-case validation, Pattern made 15 outer calls:

- 8 stayed single-pass
- 7 triggered the ensemble
- 21 model passes were used for those 7 ensemble calls
- 29 total model calls across the test

That works out to about a 1.9x average multiplier across that test set.

The worst case is still 3x for an individual call when the ensemble is
triggered.

### What the ensemble can and cannot solve

The ensemble reduces the chance that one unlucky model judgment
determines the result. It doesn't eliminate uncertainty.

If the underlying evidence is genuinely ambiguous, three runs can still
disagree.

For example, the image-gallery validation case continued to flip between
outer runs. When that happened, the ensemble consistently reported a 2/3
split with `confidence: "low"`.

That's expected behavior: the tool is exposing uncertainty instead of
presenting an ambiguous result as certain.

### Session call cap

Pattern limits the number of API calls to 40 per server process by
default.

You can change this with:

```
PATTERN_SESSION_CAP
```

The cap protects against runaway agents, such as an agent stuck in a
retry loop or repeatedly asking for the same recommendation.

The 40-call default is based on the project's validation work. A
realistic project with roughly 25 components would use about 25 calls
for a full pass, leaving room for iteration.

Skip-listed primitives don't count because they never reach the API.

The counter lives in memory and resets when the server restarts.

If 40 calls is too low for your project, increase `PATTERN_SESSION_CAP`
rather than repeatedly restarting the server.

## Local call log

Every API call is recorded in a local log.

By default:

```
~/.pattern/calls.log
```

You can change the location with:

```
PATTERN_LOG_PATH
```

The log is local. Pattern does not send it anywhere.

Each API call adds one JSON line, for example:

```json
{
  "timestamp": "2026-08-24T21:12:43.882Z",
  "component_need": "cancellation policy display",
  "domain": "Airbnb-style rental marketplace",
  "framework": "React + Tailwind",
  "verdict": "custom_build",
  "confidence": "high",
  "reason": "scored",
  "coverage": "2/8 (25%)",
  "ensemble_triggered": false,
  "reference_sources_grounded": ["Mobbin", "Figma Community"]
}
```

Additional fields appear when relevant:

- `ensemble_agreement` appears when the ensemble runs.
- `reference_sources_grounded` appears for `custom_build` results and
  lists only sources that produced a grounded reference.

The log deliberately does not contain:

- The full `requirements_checked` evidence
- Your Anthropic API key

It does contain `component_need` and `domain`, so avoid putting sensitive
information in those fields. See [SECURITY.md](./SECURITY.md).

The log directory is created automatically.

If Pattern cannot write to the log because of permissions, a read-only
filesystem, or a full disk, it reports the problem to stderr but does not
fail the tool call.

### Review a log

You can summarize a log with:

```
node summarize-log.js [path]
```

If no path is provided, it uses the same default location as the server.

The summary includes:

- Verdict and confidence breakdown
- Reason breakdown
- Ensemble trigger and agreement rates
- Reference-source grounding rates for custom builds
- Component needs that were requested more than once

Repeated component needs can be useful to investigate alongside the
[session call cap](#session-call-cap).

## Known limitations

### Model judgment can vary

Pattern's search results can stay the same while the model's
interpretation of those results changes between runs.

Validation found cases where two runs found the same named components
using the same search queries but judged the same evidence differently.

For example, the model interpreted an Export action as present in one
run and absent in another.

This is a limitation of model-based evidence judgment, not necessarily a
search or code problem.

The boundary-risk ensemble exists to detect and surface this uncertainty.

### No caching, by design

Every recommendation searches and scores again.

This means a recommendation can change as component libraries change.
For example, a later shadcn/ui release can introduce a component that
changes a previous `custom_build` result.

Do not persist a recommendation across sessions or builds at the
calling-agent layer.

If you add caching, keep it session-scoped.

[Project decision memory](#per-project-decision-memory) does not change
this. It provides context from previous decisions, but every
`recommend_component` call still performs a fresh search and scoring
pass.

### The skip-list is still evolving

The primitive skip-list is a starting point and has not yet been
validated against broad real-world usage.

Watch for two failure modes:

- Agents calling Pattern for things that should have been skipped.
- Agents building generic UI for something that should have been on the
  skip-list.

The local call log can help identify both patterns.

### Pattern needs internet access

Pattern requires outbound access to:

```
api.anthropic.com
```

It also depends on whatever external sites the model's `web_search` tool
can reach.

It will not work in an environment that blocks general outbound internet
access.

### Requirements and coverage are judgment calls

Requirement extraction and evidence scoring are performed by the model.

Pattern adds safeguards such as:

- Structured requirements
- Server-side coverage recalculation
- Decision thresholds
- Boundary-risk ensembling
- Grounding checks for reference URLs

But the underlying interpretation of whether evidence satisfies a
requirement is still model judgment.

When introducing Pattern into a new workflow, spot-check early results
against the actual components before relying on it unattended.

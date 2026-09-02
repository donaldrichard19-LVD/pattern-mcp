# Pattern

[![Publish](https://github.com/donaldrichard19-LVD/pattern-mcp/actions/workflows/publish.yml/badge.svg)](https://github.com/donaldrichard19-LVD/pattern-mcp/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/pattern-mcp.svg)](https://www.npmjs.com/package/pattern-mcp)
[![npm downloads](https://img.shields.io/npm/dm/pattern-mcp.svg)](https://www.npmjs.com/package/pattern-mcp)
[![MIT license](https://img.shields.io/badge/license-MIT-111111.svg)](./LICENSE)

Pattern is an MCP server that checks a UI component need against real,
current evidence before your agent commits to it, so a wrong decision
gets caught before it's built, not after.

[Website](https://usepattern.sh) · [npm](https://www.npmjs.com/package/pattern-mcp) · [Report an issue](https://github.com/donaldrichard19-LVD/pattern-mcp/issues/new/choose)

## Install

```bash
npm install pattern-mcp
```

See [Quick Start](#quick-start) below to add your Anthropic API key and connect
Pattern to your MCP client.

## What Pattern Does

Instead of returning a list of search results, Pattern looks at what you
need, checks real components against that need, and tells the agent
whether to:

- **Use an existing component** from shadcn/ui, 21st.dev, or ReUI
- **Build a custom component**, using a real product reference from
  Mobbin and/or Figma Community

Pattern is designed for agents to use **while they are building**.

It exposes eleven tools:

- `recommend_component` — evaluates a UI component need and returns a
  structured recommendation.
- `extract_requirements` — runs just the requirement-extraction step on
  its own, so you can inspect or hand-edit the checklist before
  `recommend_component` spends its search+score budget on it.
- `record_component_decision` — records what the agent actually did so
  future recommendations in the same project can take that decision into
  account.
- `read_ledger` — lists past `recommend_component` judgments for a
  `project_id`, including any that were served from the ledger cache (see
  [Per-project judgment ledger](#per-project-judgment-ledger)); pass
  `feature_id` instead of browsing by keyword to get a full cost rollup for
  one feature (see [Tool: `report_build_cost`](#tool-report_build_cost)).
- `report_build_cost` — self-reports the end-to-end build cost for one
  feature, so cost incurred after Pattern's own verdict (the actual
  scaffold/install/build) is still attributable back to it.
- `report_outcome_proxy` — self-reports a value signal (rework, time to
  merge, kept-vs-replaced) for one feature, deliberately independent of
  Pattern's own verdict -- see [Outcome
  proxies](#outcome-proxies).
- `check_ledger_liveness` — checks whether a ledger entry's recorded
  `file_path` still exists and still references its `chosen_candidate` --
  see [Tool: `check_ledger_liveness`](#tool-check_ledger_liveness).
- `export_ledger_provenance` — formats one ledger entry as a stable
  markdown block (checklist, candidates, verdict, `snapshot_ref`) you can
  paste into a PR or issue by hand -- see [Tool:
  `export_ledger_provenance`](#tool-export_ledger_provenance).
- `post_ledger_provenance_to_github` — posts that same artifact as a real
  comment on a GitHub PR/issue, idempotently -- see [Tool:
  `post_ledger_provenance_to_github`](#tool-post_ledger_provenance_to_github).
  The one tool here with a real, visible side effect outside your own
  machine; confirm with the user before calling it.
- `sweep_ledger_liveness` — batch version of `check_ledger_liveness`
  across a whole project (or every project in the ledger), plus
  dangling-cluster detection -- see [Tool:
  `sweep_ledger_liveness`](#tool-sweep_ledger_liveness). Meant to be
  invoked by your own cron/CI, not something Pattern schedules itself.
- `backfill_ledger_snapshot_ref` — best-effort `snapshot_ref`
  reconstruction for entries written before that field existed -- see
  [Tool: `backfill_ledger_snapshot_ref`](#tool-backfill_ledger_snapshot_ref).

## How it works

![How it works](docs/images/how-it-works.png)

For each `recommend_component` call, Pattern:

1. Checks whether the need is a simple primitive that doesn't require a
   search.
2. Turns the request into a set of specific requirements, unless a
   checklist was already supplied (see [`checklist`](#checklist)).
3. Searches for matching shadcn/ui, 21st.dev, and ReUI components.
4. Checks each candidate against the requirements using evidence from the
   actual component.
5. Calculates how much of the requirement is covered.
6. Decides whether to use an existing component or build a custom one.
7. If a custom build is needed, searches Mobbin and Figma Community for
   real product examples.
8. Returns the result as structured JSON the calling agent can act on.

Coverage is calculated by the server from the individual requirements it
checked. It does not simply trust the percentage returned by the model.

A result can also be:

- `use_existing`
- `custom_build`
- `no_candidates_found`
- `skip_list`
- `ledger_cache_hit` — served from a recent, matching prior judgment
  instead of a fresh search+score (see
  [Per-project judgment ledger](#per-project-judgment-ledger)).

`no_candidates_found` is kept separate from a low-coverage result. Not
finding a candidate is different from finding candidates that don't cover
the requirements.

If `project_id` is supplied, Pattern also checks for past confirmed
decisions on that project and factors them in as a consistency signal —
never a rule that overrides a genuinely better match found in the current
search. Separately, `project_id` also enables the judgment ledger: a
high-confidence prior judgment matching this exact
component_need/domain/framework/existing_stack, recorded recently enough,
can be served directly (`ledger_cache_hit`) instead of running a fresh
search+score. This is the one deliberate exception to "every recommendation
searches and scores again" — see
[Per-project judgment ledger](#per-project-judgment-ledger) for the exact
rules and why it's safe.

Every result includes `computed_at`, because coverage is a snapshot of the
search at that point in time, not a permanent fact. Every result also
includes `_meta` — the timing and token cost of that specific call (see
[Cost](#cost)).

### Boundary-risk checks

The same evidence can sometimes be judged slightly differently between
model runs. When a result is close enough to a decision threshold that it
could change the verdict, Pattern automatically runs the judgment two more
times and uses the majority result.

If the three runs disagree, Pattern returns:

```json
{
  "confidence": "low",
  "ensemble": {
    "triggered": true,
    "runs": ["use_existing", "custom_build", "use_existing"],
    "agreement": "2/3"
  }
}
```

Results that are clearly inside a threshold don't trigger extra runs — see
[Cost](#cost) below for the measured impact.

### Simple primitives

These are handled locally without an API call:

| Primitive | Use it for |
| --- | --- |
| `button` | A clickable action trigger |
| `input` | A single-line text entry field |
| `checkbox` | A binary on/off toggle |
| `label` | A caption for a field or control |
| `badge` | A small status or count indicator |
| `spinner` | An indeterminate loading indicator |
| `tooltip` | A contextual hover/focus hint |
| `avatar` | A user or entity image, or initials |
| `icon` | A single glyph or symbol |

This keeps trivial requests fast and avoids unnecessary API usage.

### What powers the search

Pattern does not scrape shadcn/ui, 21st.dev, ReUI, Mobbin, or Figma Community
itself.

Each tool call makes one or more requests to the Anthropic Messages API,
using `claude-sonnet-5` by default. The server enables Anthropic's
`web_search` tool and provides a system prompt that defines the full
decision process.

That process includes:

- Skip-list checks
- Requirement extraction
- Component search
- Evidence-based coverage scoring
- Decision thresholds
- Mobbin and Figma Community reference searches when a custom build is
  needed

Figma Community does not require a Figma API key. Pattern uses the same
web search mechanism for Figma Community as it does for the other sources.

The model returns structured JSON. Pattern then applies important checks
itself, including recalculating coverage and applying the decision
threshold.

## Quick Start

### 1. Install

```bash
npm install pattern-mcp
```

This installs the `pattern-mcp` command via `npx` (or your project's
local `node_modules/.bin`), used in the client configs below.

<details>
<summary>Build from source instead</summary>

```bash
git clone <this repo>
cd pattern-mcp
npm install
npm run build
```

Use `node /absolute/path/to/pattern-mcp/dist/index.js` as the server
command in place of `npx pattern-mcp` in the examples below.

</details>

### 2. Add your Anthropic API key

Pattern requires:

```
ANTHROPIC_API_KEY
```

The API account associated with this key pays for the requests Pattern
makes (see [Cost](#cost) below).

You get the key from the Anthropic Console under Settings → API Keys.
API billing is separate from Claude.ai or Claude Code subscriptions. A
Claude Pro or Max subscription does not include API usage.

### Connect Pattern to your MCP client

Pattern is a standard MCP server, so it works with MCP-compatible
clients.

The server command is:

```
npx pattern-mcp
```

#### Claude Code

You can add Pattern to your project's `.mcp.json` or register it with the
CLI.

For the current project:

```bash
claude mcp add pattern \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -- npx pattern-mcp
```

This uses the default local scope, so the server is available to the
current project.

To make Pattern available across your projects:

```bash
claude mcp add pattern \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  --scope user \
  -- npx pattern-mcp
```

**Important:** put `-e`/`--env` and `--scope` before the `--`. Everything
after `--` is treated as the command and its arguments.

Check the connection with:

```bash
claude mcp list
```

You should see Pattern with a `✔ Connected` status.

`claude mcp add` stores the configuration in `~/.claude.json`. Avoid
`claude mcp get pattern` when possible because it can print your API key
in plaintext.

#### Cursor

Add Pattern to:

```
.cursor/mcp.json
```

#### Codex CLI

Pattern can be configured globally in:

```
~/.codex/config.toml
```

or at the project level in:

```
.codex/config.json
```

Use the MCP configuration format supported by your Codex CLI version.

#### Claude Desktop

Add Pattern through Claude Desktop's MCP settings.

The configuration looks like:

```json
{
  "mcpServers": {
    "pattern": {
      "command": "npx",
      "args": ["pattern-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Restart your MCP client after adding Pattern.

Then ask your agent to list its available MCP tools and look for:

```
recommend_component
```

## Try it

Give your agent a specific UI need, for example:

> Use recommend_component to find me a UI component for a price breakdown
> showing nightly rate, cleaning fee, service fee, and taxes. I'm building
> an Airbnb-style booking checkout in React with Tailwind.

The agent should use the result to make the next decision:

- Install or use the recommended component, or
- Start a custom build using the returned requirements and product
  references.

Pattern returns useful descriptions for both paths.

- For an existing component, `component_description` explains what the
  component does and looks like before the agent installs it.
- For a custom build, `reference_description` explains what each Mobbin
  or Figma Community reference actually shows.

These descriptions are grounded in what Pattern found during the search
rather than generic descriptions.

## Validation examples

Pattern's validation suite uses five UI needs from an Airbnb-style rental
marketplace:

- Price breakdown with fees and taxes
- Cancellation policy display
- Host earnings dashboard
- Property image gallery
- Host-guest messaging inbox

Together, these cover different outcomes, including clear matches,
false-positive-prone searches, no candidates, and decisions close to the
threshold.

## Tool: `recommend_component`

### Input

```json
{
  "component_need": "price breakdown with fees and taxes",
  "domain": "Airbnb-style rental marketplace",
  "framework": "React + Tailwind",
  "existing_stack": "already using shadcn/ui",
  "project_id": "my-booking-app"
}
```

`component_need` should describe the actual UI you need, not just a
category.

Good: `price breakdown with fees and taxes`
Too vague: `pricing`

Vague requests can produce misleading matches. For example, a generic
SaaS pricing table may look like a match for "pricing" even though it
doesn't work for a booking checkout.

#### `project_id`

`project_id` is optional.

When provided, Pattern can use decisions previously recorded for the
same project (see [Per-project decision memory](#per-project-decision-memory))
as a consistency signal.

A previous decision can help the model stay consistent with similar UI
decisions, but it cannot override a better match found in the current
search.

Pattern still searches and scores every request from scratch. Past
decisions never cause a search to be skipped.

If you leave out `project_id`, Pattern does not use project memory.

#### `checklist`

`checklist` is optional -- an array of requirement strings.

When provided, `recommend_component` skips its own internal requirement
extraction entirely and scores coverage against exactly the items you
passed, instead of extracting its own checklist. Search and scoring still
run fresh every call; only the extraction step is skipped.

This is meant to be used together with [`extract_requirements`](#tool-extract_requirements):
call `extract_requirements` first, inspect (or hand-edit) the checklist it
returns, then pass that checklist here. That gives you a chance to catch a
misread requirement before Pattern spends its search+score budget.

Leave `checklist` out to keep today's default behavior: `recommend_component`
extracts its own checklist internally, exactly as before this option
existed.

#### `feature_id`

`feature_id` is optional -- a stable identifier for the feature this
component need belongs to (e.g. a ticket id or branch name). Its only use
is joining this call's cost with a later
[`report_build_cost`](#tool-report_build_cost) call for the same feature.
Omit it to have one derived deterministically from `project_id` +
`component_need`; only meaningful together with `project_id`. See
[Feature cost attribution](#feature-cost-attribution).

#### `file_path`

`file_path` is optional -- path (relative to `PROJECT_ROOT`) where this
component decision is expected to be implemented, if already known.
Usually not known yet at call time, since the decision typically precedes
the file existing. When provided, it's stored on the resulting ledger
entry and [`check_ledger_liveness`](#tool-check_ledger_liveness) can later
confirm the file still exists and still references `chosen_candidate`. It
cannot currently be attached to an entry after the fact -- see [Ledger
integrity and decision provenance](#ledger-integrity-and-decision-provenance).

**Is the checklist actually skipped, not just re-derived?** Checked, not
assumed. `breakdown_ms.extract` for a `checklist`-provided call is smaller
than the default path's, but not near-zero -- which raised the question of
whether the model is still doing some of the extraction work in that
window rather than treating the checklist as fixed input. Reading the
model's actual reasoning (via `thinking` with `display: "summarized"`,
5 runs: 3 with `checklist` provided, 2 default) answered it: the
`checklist`-provided runs' pre-search reasoning was a short, generic
"search shadcn/ui and 21st.dev" thought with no mention of the checklist's
content, e.g. *"I should look for existing image gallery component options
on shadcn/ui and 21st.dev"* -- consistently ~3-4 seconds. The default
runs' reasoning, by contrast, explicitly enumerated and derived the
checklist items (*"...mapping out the checklist: a photo grid with hero
and thumbnails... a full-screen lightbox with next/prev navigation,
keyboard support..."*) and took roughly 2x longer (~7-8 seconds). The
remaining time in the `checklist`-provided path is baseline model latency
before it decides to search, not re-extraction -- it doesn't scale with or
reference the checklist's content.

### Output

```json
{
  "verdict": "use_existing | custom_build",
  "confidence": "high | medium | low",
  "reason": "scored | no_candidates_found | skip_list",
  "computed_at": "2026-08-23",
  "requirements_checked": [
    {
      "requirement": "...",
      "met": true,
      "evidence": "..."
    }
  ],
  "coverage": "5/7 (71%)",
  "recommendation": {
    "source": "21st.dev | shadcn | reui | null",
    "install_command": "string | null",
    "component_description": "string | null",
    "reference": {
      "source": "Mobbin | Figma Community",
      "url": "...",
      "flow_name": "...",
      "file_name": "...",
      "reference_description": "...",
      "url_type": "deep_link | entry_point"
    }
  },
  "ensemble": {
    "triggered": false
  },
  "checklist_source": "extracted | provided",
  "_meta": {
    "total_ms": 41516,
    "breakdown_ms": { "extract": 5006, "search": 3114, "score": 33396 },
    "tokens_used": { "input": 8400, "output": 620 },
    "estimated_cost_usd": 0.14
  }
}
```

The `past_decision_signal` field is included only when there is a
relevant previous decision for the supplied `project_id`.

`checklist_source` is always present: `"extracted"` when Pattern derived
the checklist itself (the default, unchanged behavior), `"provided"` when
you passed one in via `checklist`.

`_meta` is always present. See [Cost](#cost) for what each field means,
how `breakdown_ms` is measured, and what it means when the ensemble
triggers.

### Reference links

When Pattern recommends a custom build, it may return references from
Mobbin, Figma Community, or both.

The `reference` field can be:

- An array when both sources returned useful results.
- A single object when only one source returned a useful result.
- `null` when neither source produced a grounded reference.

#### Deep links vs. entry points

Pattern tells you whether a reference URL points directly to the
identified screen or flow.

`"url_type": "deep_link"` means Pattern verified that the URL points to
the specific reference.

`"url_type": "entry_point"` means the URL is a search or browse page. The
agent may need to find the specific screen or flow from there.

For Mobbin, Pattern fetches the search result page and looks for a more
specific link to the screen or flow it identified.

For Figma Community, URLs containing `/community/file/` are already
specific to a file and are treated as deep links. Other Figma URLs are
checked like Mobbin URLs.

Pattern never invents a URL. If it cannot verify a specific link, it
keeps the real search result URL and clearly identifies it as an entry
point.

### Installation commands are not trusted

The `install_command` comes from search results. It is not verified
against a package registry, and Pattern does not execute it.

The calling agent should:

1. Show the command to the user.
2. Get confirmation.
3. Run it only after confirmation.

See [SECURITY.md](./SECURITY.md) for more details.

## Tool: `extract_requirements`

Runs only the requirement-extraction step `recommend_component` normally
does internally, and returns just the checklist -- no search, no scoring,
no verdict.

This is an opt-in, two-call pattern for agents that support tool search or
code-mode style tool use: call `extract_requirements` first, inspect (or
hand-edit) the checklist it returns, then pass that checklist to
`recommend_component`'s optional `checklist` input to score against it
directly, skipping `recommend_component`'s own internal extraction.

The single-call default -- just calling `recommend_component` with no
`checklist` -- is unchanged and is still the recommended path for most
callers. Reach for `extract_requirements` when you specifically want to
catch a misread requirement before Pattern spends its search+score budget,
not as a routine first step.

### Input

```json
{
  "component_need": "image gallery for a property listing",
  "domain": "Airbnb-style rental marketplace"
}
```

Same fields, same meaning, as `recommend_component`'s `component_need` and
`domain`. There is no `framework` input here -- extraction is grounded in
the domain, not the framework, so `framework` doesn't affect the checklist
in `recommend_component` either.

### Output

```json
{
  "checklist": ["...", "...", "..."],
  "extraction_confidence": "high | medium | low",
  "_meta": {
    "total_ms": 6798,
    "breakdown_ms": { "extract": 6798, "search": 0, "score": 0 },
    "tokens_used": { "input": 275, "output": 302 },
    "estimated_cost_usd": 0.0036
  }
}
```

Typical latency is a few seconds -- one small API call with no tools
declared, versus `recommend_component`'s full search+score pipeline.

**`extraction_confidence` is a placeholder heuristic, not a validated
signal.** It's currently derived from how specific `component_need` is
(word count) -- the same "vague category name" problem the rest of this
README warns about elsewhere. It is not based on any measured correlation
with actual extraction quality. Treat `"low"` as a prompt to reread your
`component_need`, not as a calibrated confidence score. This is flagged
here as a known gap, to revisit once there's real usage data to base a
better signal on.

Trivial primitives (see [Simple primitives](#simple-primitives)) return an
empty `checklist` with `extraction_confidence: "high"` and no API call, the
same local skip-list short-circuit `recommend_component` uses.

## Tool: `record_component_decision`

Use this tool after the agent has actually acted on a component
decision.

For example, call it after:

- Installing an existing component
- Completing a custom build

Do not call it for every recommendation.

The tool only saves the decision. It does not run a judgment or make an
Anthropic API call.

### Input

```json
{
  "project_id": "my-booking-app",
  "component_need": "price breakdown with fees and taxes",
  "domain": "Airbnb-style rental marketplace",
  "action": "custom_built",
  "source": "custom",
  "timestamp": "2026-08-25T14:32:00.000Z",
  "time_saved_minutes": 25
}
```

- `project_id` is required and should be stable. A project directory
  path or project name works well.
- `action` must be `"installed"` or `"custom_built"`.
- `source` can be `"shadcn"`, `"21st.dev"`, `"reui"`, or `"custom"`.
- `timestamp` is optional. If omitted, Pattern uses the current time.
- `time_saved_minutes` is optional -- the calling agent's own estimate,
  in minutes, of how much time this decision saved by having Pattern's
  verdict instead of researching candidates and judging fit from scratch.
  This is entirely self-reported. Pattern has no way to measure a
  counterfactual ("how long would this have taken without Pattern?"), so
  unlike `_meta` (Pattern's own real cost/latency for the call that
  produced the verdict), this number is never computed or verified --
  it's just recorded as-given. Omit it rather than guess a number to fill
  the field.

### Output

```json
{
  "status": "recorded",
  "project_id": "my-booking-app",
  "entry": { "..." }
}
```

## Tool: `read_ledger`

Lists past `recommend_component` judgments for a `project_id` -- every
call that reached the API and produced a verdict, not just ones explicitly
confirmed via `record_component_decision`. Useful for auditing what
Pattern has already judged for a project, or for understanding why a call
came back with `served_from_ledger: true`.

### Input

```json
{
  "project_id": "my-booking-app",
  "component_need": "cancellation",
  "limit": 10
}
```

- `project_id` is required.
- `component_need` is optional -- a simple keyword filter (substring
  match, no embeddings) against stored entries' `component_need`. Omit to
  list everything for the project.
- `limit` is optional, defaults to 20. Most recent entries first.
- `feature_id` is optional. When provided, `component_need` and `limit`
  are ignored and the response is a full cost rollup for that one feature
  instead of a keyword listing -- see [Feature cost
  attribution](#feature-cost-attribution).

### Output

```json
{
  "project_id": "my-booking-app",
  "entries": [
    {
      "id": "a1b2c3d4-...",
      "timestamp": "2026-08-29T19:50:47.073Z",
      "project_id": "my-booking-app",
      "feature_id": "3f9a21c0",
      "component_need": "cancellation policy display with refund tiers by date",
      "domain": "Airbnb-style rental marketplace",
      "framework": "React + Tailwind",
      "checklist": ["...", "..."],
      "checklist_source": "extracted",
      "candidates_evaluated": [
        { "source": "ReUI (reui.io)", "name": "Timeline", "url": "https://reui.io/components/timeline", "coverage_pct": 62.5 }
      ],
      "verdict": "use_existing",
      "chosen_candidate": "Timeline",
      "confidence": "low",
      "reason": "scored",
      "coverage": "5/8 (62.5%)",
      "cost_usd": 0.087,
      "cache_hit": false,
      "project_conventions_snapshot": "9f3a1c7e2b0d4f5a",
      "file_path": null,
      "snapshot_ref": "a1b2c3d4e5f6...",
      "last_verified_live": null,
      "live_status": "unknown",
      "reconstructed_snapshot_ref": null
    }
  ]
}
```

`file_path`/`snapshot_ref`/`last_verified_live`/`live_status`/
`reconstructed_snapshot_ref` are the ledger integrity + decision
provenance fields -- see [Ledger integrity and
decision provenance](#ledger-integrity-and-decision-provenance) and [Tool:
`check_ledger_liveness`](#tool-check_ledger_liveness). Entries written
before this feature shipped read back with `file_path`/`snapshot_ref`/
`last_verified_live` as `null` and `live_status` as `"unknown"` rather
than missing keys.

Passing `feature_id` instead returns:

```json
{
  "project_id": "my-booking-app",
  "feature_id": "3f9a21c0",
  "verdict_entries": [ "...same shape as above, filtered to this feature_id..." ],
  "build_records": [
    { "id": "...", "timestamp": "...", "project_id": "my-booking-app", "feature_id": "3f9a21c0", "tokens_used": 9000, "cost_usd": 1.25, "outcome": "shipped" }
  ],
  "total_cost_usd": 1.34,
  "outcome_proxy": { "time_to_merge_hours": 3.5, "reworked": true, "days_to_rework": 12, "status_at_30d": "kept" },
  "outcome_proxy_history": [ "...every raw report_outcome_proxy record for this feature_id, oldest first..." ]
}
```

`outcome_proxy` is `null` (and `outcome_proxy_history` an empty array)
when no `report_outcome_proxy` calls have been made for this feature yet
-- see [Outcome proxies](#outcome-proxies).

Each entry holds only distilled fields -- `candidates_evaluated` never
contains raw HTML, full prop tables, or the per-requirement evidence text
`recommend_component` itself returns. See
[Data minimization](#data-minimization) below.

## Tool: `report_build_cost`

Self-reports the end-to-end build cost for one feature. Pattern only ever
sees the cost of judging *what* to use (`recommend_component`'s own
`_meta.estimated_cost_usd`); everything past that -- the actual scaffold,
install, or custom build -- happens outside Pattern entirely and Pattern
has no way to observe it. Call this once, after the calling agent's build
for a feature is actually complete (shipped, abandoned, or replaced), not
on every verdict.

### Input

```json
{
  "feature_id": "3f9a21c0",
  "project_id": "my-booking-app",
  "tokens_used": 9000,
  "cost_usd": 1.25,
  "outcome": "shipped"
}
```

- `feature_id` is required -- either a value you explicitly passed to an
  earlier `recommend_component` call for this feature, or (if you didn't)
  the same value `recommend_component` derives on its own:
  `sha256(project_id + "::" + component_need, lowercased/trimmed)`
  truncated to 8 hex characters. When in doubt, call `read_ledger` with
  just `project_id` and copy the `feature_id` off the relevant entry
  rather than re-deriving it by hand.
- `project_id` is optional but recommended -- without it, this record
  still joins to a `recommend_component` entry by `feature_id` alone, but
  `read_ledger`'s rollup can't scope it to one project.
- `tokens_used` is optional.
- `cost_usd` is required -- your own real number, not Pattern's.
- `outcome` is required: `"shipped"`, `"abandoned"`, or
  `"replaced_with_existing"`.

### Output

```json
{
  "status": "recorded",
  "record": {
    "id": "c5706b47-...",
    "timestamp": "2026-09-02T01:25:29.653Z",
    "project_id": "my-booking-app",
    "feature_id": "3f9a21c0",
    "tokens_used": 9000,
    "cost_usd": 1.25,
    "outcome": "shipped"
  }
}
```

This only appends a local record to `~/.pattern/build_ledger.jsonl`
(override with `PATTERN_BUILD_LEDGER_PATH`) -- it never re-runs any
judgment and never calls the Anthropic API.

## Tool: `report_outcome_proxy`

Self-reports a value signal for one feature, deliberately independent of
Pattern's own verdict -- the whole point is a signal that could
*contradict* the verdict, so nothing on this path ever reads
`coverage_pct`, `confidence`, or any other Pattern-produced field. Compute
`reworked`/`days_to_rework` and `time_to_merge_hours` from your own repo's
real git history (e.g. `git log --follow` against the files this
feature's build touched) rather than relying on Pattern -- rework rate and
time-to-merge need real git *history*, a materially bigger surface than
the one narrow, read-only exception described in [Ledger integrity and
decision provenance](#ledger-integrity-and-decision-provenance) below.
Report `status_at_30d` only once a real ~30-day-post-merge horizon has
actually passed.

Safe to call more than once for the same `feature_id` as more signal
becomes available over time -- e.g. `time_to_merge_hours` right after
merge, `reworked` on a later re-check, `status_at_30d` at the 30-day mark.
`read_ledger`'s `feature_id` rollup merges every report into one
latest-value-per-field view (a later report only overwrites the specific
fields it includes, never the others).

### Input

```json
{
  "feature_id": "3f9a21c0",
  "project_id": "my-booking-app",
  "reworked": true,
  "days_to_rework": 12
}
```

- `feature_id` is required.
- `project_id` is optional but recommended, same reasoning as
  `report_build_cost`.
- `reworked`, `days_to_rework`, `time_to_merge_hours`, `status_at_30d` are
  all individually optional, but **at least one is required** -- an empty
  report is rejected rather than silently recording nothing.

### Output

```json
{
  "status": "recorded",
  "record": {
    "id": "8a2f1e0c-...",
    "timestamp": "2026-09-16T18:04:12.881Z",
    "project_id": "my-booking-app",
    "feature_id": "3f9a21c0",
    "reworked": true,
    "days_to_rework": 12
  }
}
```

This only appends a local record to `~/.pattern/outcome_proxies.jsonl`
(override with `PATTERN_OUTCOME_PROXY_PATH`) -- it never calls the
Anthropic API.

## Tool: `check_ledger_liveness`

Checks whether ledger entries for a `project_id` are still **live** --
does the `file_path` recorded on the entry (if any, see
[`file_path`](#tool-recommend_component)) still exist, and does it still
mention `chosen_candidate`. See [Ledger integrity and decision
provenance](#ledger-integrity-and-decision-provenance) for the full design
and its deliberate limits.

This is the **one exception** to Pattern otherwise having no filesystem
access to your repo (see [Outcome proxies](#outcome-proxies) above) --
scoped narrowly to read-only `fs.existsSync`/file-read calls against
`PROJECT_ROOT` (defaults to this server's own working directory; override
with `PATTERN_PROJECT_ROOT`). It never writes to your repo and never runs
an arbitrary shell command.

### Input

```json
{
  "project_id": "my-booking-app",
  "ledger_entry_id": "a1b2c3d4-..."
}
```

- `project_id` is required.
- `ledger_entry_id` is optional -- check just that one entry instead of
  every entry for `project_id` that has a `file_path` set.

### Output

```json
{
  "project_id": "my-booking-app",
  "checked": 1,
  "total_entries": 2,
  "results": [
    {
      "ledger_entry_id": "a1b2c3d4-...",
      "component_need": "cancellation policy display with refund tiers by date",
      "file_path": "src/components/CancellationPolicy.tsx",
      "live_status": "live",
      "checked_at": "2026-09-02T20:11:03.442Z",
      "note": null
    },
    {
      "ledger_entry_id": "e5f6a7b8-...",
      "component_need": "gallery",
      "file_path": null,
      "live_status": "unknown",
      "checked_at": null,
      "note": "no file_path recorded on this entry -- nothing to check"
    }
  ]
}
```

`live_status` is one of `"live"`, `"orphaned"`, `"unknown"`, or
`"dangling"` (only ever produced by
[`sweep_ledger_liveness`](#tool-sweep_ledger_liveness)'s cluster
detection, never by a single-entry `check_ledger_liveness` call -- see
[Ledger integrity and decision
provenance](#ledger-integrity-and-decision-provenance)).
Entries with no `file_path` are listed but never checked or written to
`ledger_liveness.jsonl` -- their status is permanently `"unknown"` since
there's nothing to check. Results here are also layered onto
`read_ledger`'s `live_status`/`last_verified_live` fields for the same
entries afterward -- `check_ledger_liveness` is the only thing that
advances those fields past their write-time defaults.

## Tool: `export_ledger_provenance`

Formats one ledger entry -- requirements checklist, candidates compared,
verdict, confidence, `snapshot_ref` -- as a single markdown block: a
stable, portable record of that decision you can paste into a PR
description or issue by hand. See [Ledger integrity and decision
provenance](#ledger-integrity-and-decision-provenance) for the full
design and its deliberate limits.

Pure and deterministic: the same entry always produces byte-identical
markdown, since the function reads nothing but its input (no live system
time, no disk state). This only formats and returns text -- it does not
post anything to GitHub or anywhere else; that's a separate action, not
yet built.

### Input

```json
{
  "project_id": "my-booking-app",
  "ledger_entry_id": "a1b2c3d4-..."
}
```

Both fields are required -- unlike `check_ledger_liveness`, there's no
"every entry for this project" mode, since a provenance artifact is
inherently about one specific decision.

### Output

```json
{
  "ledger_entry_id": "a1b2c3d4-...",
  "markdown": "## Pattern decision: cancellation policy display with refund tiers by date\n\n- **Verdict:** use_existing (confidence: high)\n- **Reason:** scored\n- **Coverage:** 5/8 (62.5%)\n- **Domain:** Airbnb-style rental marketplace\n- **Framework:** React + Tailwind\n- **Snapshot:** `9f3a1c7e2b0d4f5a6b7c8d9e0f1a2b3c4d5e6f70`\n- **Judged at:** 2026-08-29T19:50:47.073Z\n\n### Requirements checked\n- ...\n\n### Candidates compared\n| Source | Name | Coverage | Chosen |\n| --- | --- | --- | --- |\n| ReUI (reui.io) | Timeline | 62.5 | ✓ |\n\n_Generated by Pattern (`export_ledger_provenance`) from ledger entry `a1b2c3d4-...`._"
}
```

Errors (as `isError: true`, not a thrown exception) when `ledger_entry_id`
doesn't match any entry for that `project_id` -- including when the id is
real but belongs to a different project, since entries are always scoped
per `project_id`.

For a `custom_build` verdict, the candidates section explains that gap in
prose instead of an empty table -- Pattern doesn't persist the
custom-build reference (Mobbin/Figma) to the ledger (see
[`distillCandidate`](#data-minimization)), so it can't reproduce it here.
A `null` `snapshot_ref` (project root wasn't a git repository at judgment
time) renders as prose too, not the literal word `null`.

## Tool: `post_ledger_provenance_to_github`

Posts one ledger entry's provenance artifact (the same content
`export_ledger_provenance` produces) as a real comment on a GitHub PR or
issue. **This is the one tool in this server with a real, visible side
effect on a third-party service** -- every other tool here only ever
touches local files. Confirm with the user before calling it, the same
way you're expected to confirm before running a suggested
`install_command` (see [Installation commands are not
trusted](#installation-commands-are-not-trusted) and SECURITY.md).

GitHub treats a PR and an issue identically for comments (both use the
same `/issues/{number}/comments` endpoint), so there's one input shape
for both -- no separate "is this a PR" flag.

### Auth: `GITHUB_TOKEN`, not a GitHub App

This resolves the open question left in [Ledger integrity and decision
provenance](#ledger-integrity-and-decision-provenance)'s earlier writeup
in favor of a **personal access token**, read from the `GITHUB_TOKEN`
environment variable -- the same convention every GitHub Action and the
`gh` CLI itself already use. Needs `repo` scope. A GitHub App was the
alternative on the table, but it needs a hosted installation flow and a
webhook receiver, which contradicts this project's entire distribution
model (a local npm package, no hosted infrastructure -- see [Ledger
integrity and decision provenance](#ledger-integrity-and-decision-provenance)
and the Pattern Primer's build-order principle). Pattern manages no
GitHub credential of its own, the same way it manages no git credential
for `snapshot_ref` -- it just reads what's already in your environment.

### Input

```json
{
  "project_id": "my-booking-app",
  "ledger_entry_id": "a1b2c3d4-...",
  "repo": "my-org/my-booking-app",
  "issue_number": 42
}
```

All four fields are required.

### Output

```json
{
  "posted": true,
  "comment_url": "https://github.com/my-org/my-booking-app/pull/42#issuecomment-...",
  "comment_id": 123456789
}
```

### Idempotent by construction

Every posted comment is prefixed with a hidden HTML marker keyed to the
ledger entry's id (`<!-- pattern-ledger-provenance:<id> -->`). A call
first checks the thread's existing comments (most recent 100 -- full
pagination isn't handled yet) for that marker; if found, it returns
`{ "posted": false, "reason": "already_posted", "comment_url": "..." }`
pointing at the existing comment instead of creating a duplicate. A
repeat call is always safe to make.

Errors (`isError: true`) clearly on: no `GITHUB_TOKEN` set, a malformed
`repo` (not `owner/repo`), an unknown `ledger_entry_id`, or a GitHub API
error (bad credentials, repo/issue not found, rate limit) -- the error
message includes the real HTTP status and GitHub's own error text.

## Tool: `sweep_ledger_liveness`

Batch version of [`check_ledger_liveness`](#tool-check_ledger_liveness):
updates `live_status` for every `file_path`-bearing entry across an
entire project, or -- when `project_id` is omitted -- every `project_id`
present in the ledger. This is the "on a schedule (project open or cron)"
half of the referential-integrity design that `check_ledger_liveness`'s
on-demand, single-project call doesn't cover.

**Pattern has no daemon or scheduler of its own.** Each server invocation
is transient, tied to its MCP host's lifecycle -- there is nowhere inside
this server for a cron job to live. This tool is meant to be invoked by
whatever external scheduler you already have (a cron job, a CI step
running nightly), not something Pattern triggers automatically or ever
will on its own.

### Input

```json
{
  "project_id": "my-booking-app"
}
```

`project_id` is optional -- omit it to sweep every `project_id` present
in the ledger in one call.

### Output

```json
{
  "projects_swept": 2,
  "total_entries_checked": 14,
  "dangling_clusters": [
    { "project_id": "my-booking-app", "feature_id": "3f9a21c0", "entry_ids": ["...", "..."] }
  ],
  "per_project": [
    { "project_id": "my-booking-app", "checked": 9, "total_entries": 12, "dangling_clusters": 1 },
    { "project_id": "other-project", "checked": 5, "total_entries": 5, "dangling_clusters": 0 }
  ]
}
```

### Dangling clusters, and how "cluster" maps onto what the ledger actually stores

The ledger has no explicit entry-to-entry reference field -- each line is
an independent judgment record. `feature_id` (see [Feature cost
attribution](#feature-cost-attribution)) is the one real grouping
construct that already exists, so a "cluster" here means every entry
sharing one `feature_id`, and "no live anchor" means none of them
resolved to `live_status: "live"`. A single-entry group is just an
ordinary orphaned/unknown entry, not a cluster phenomenon, so groups of
one are never flagged.

Every entry in a qualifying cluster gets `live_status: "dangling"` --
overriding whatever `"orphaned"`/`"unknown"` value it had -- visible on
its next `read_ledger`/`check_ledger_liveness` read via the same
`ledger_liveness.jsonl` overlay `check_ledger_liveness` already writes to
(see [Referential integrity](#referential-integrity-file_path--live_status)).
Tested against the exact repro shape reported by a user: 13 entries, 12
sharing a `feature_id` with no live anchor among them, 1 separate and
live -- all 12 flag `dangling`, the 13th doesn't. Also tested at 200 and
1,000 synthetic entries without reintroducing search+score-class latency
(both complete in well under a second -- this is `fs.existsSync` calls
and in-memory grouping, not API calls).

## Tool: `backfill_ledger_snapshot_ref`

Best-effort reconstruction of `snapshot_ref` for ledger entries written
before that field existed (or written outside a git repository): finds
the commit that was `HEAD` at or just before each entry's own timestamp
(`git log --before=<timestamp> -1 --format=%H`). Entries that already
have a real `snapshot_ref` are reported but never touched -- backfill
only ever fills a gap, never second-guesses a captured value.

### Input

```json
{
  "project_id": "my-booking-app",
  "ledger_entry_id": "a1b2c3d4-..."
}
```

`ledger_entry_id` is optional -- omit it to backfill every entry in the
project missing `snapshot_ref`.

### Output

```json
{
  "project_id": "my-booking-app",
  "attempted": 3,
  "reconstructed": 2,
  "results": [
    { "ledger_entry_id": "a1b2c3d4-...", "already_had_snapshot_ref": false, "reconstructed_snapshot_ref": "9f3a1c7e2b0d4f5a6b7c8d9e0f1a2b3c4d5e6f70" },
    { "ledger_entry_id": "e5f6a7b8-...", "already_had_snapshot_ref": false, "reconstructed_snapshot_ref": null }
  ]
}
```

### A reconstructed value is always labeled, never presented as real

Necessarily an approximation, not a guarantee: a rebase, force-push, or
history rewrite since that timestamp can make "the commit `HEAD` pointed
to then" no longer resolve to what the codebase actually looked like at
judgment time. Every attempt is persisted (including failures -- a
project whose git history doesn't reach back that far, or that isn't a
git repository at all) to `~/.pattern/snapshot_backfill.jsonl` (override
with `PATTERN_SNAPSHOT_BACKFILL_PATH`), and surfaces on later reads as
`reconstructed_snapshot_ref` -- a field kept fully separate from
`snapshot_ref` itself, never overwriting or being confused with it.
[`export_ledger_provenance`](#tool-export_ledger_provenance) and
[`post_ledger_provenance_to_github`](#tool-post_ledger_provenance_to_github)
both render a reconstructed value with an explicit "(reconstructed via
backfill -- best-effort approximation, not the original captured
snapshot)" label, never silently as if it were equivalent to a value
captured live.

Tested against a real throwaway git repo with known commit history (an
entry timestamped between two real commits reconstructs to exactly the
first one), a 200-entry synthetic ledger outside any git repo (every
attempt fails fast and reports `null` rather than throwing), and a
read-only run against this project's own real `coop-commerce` ledger
entries, per the spec's own test plan.

## Feature cost attribution

Every `recommend_component` call that writes to the ledger -- a fresh
judgment *or* a $0 [ledger cache hit](#the-cache-hit-exception) -- now
carries a `feature_id`, plus its own `cost_usd` and `cache_hit`. Pair that
with `report_build_cost`'s build-time record and `read_ledger`'s
`feature_id` rollup, and total spend on a feature (judgment + build,
across however many calls) is queryable end to end, not just the cost of
one verdict call.

`feature_id` defaults to a deterministic derivation --
`sha256(project_id + "::" + component_need)` truncated to 8 hex chars --
so repeat calls for the same feature land under the same id automatically,
with no coordination needed between `recommend_component` and
`report_build_cost` calls. Pass your own `feature_id` explicitly (e.g. a
ticket id or branch name) if you'd rather key on something stable on your
own side.

## Outcome proxies

Cost data alone (`feature cost attribution` above) can't answer whether a
cheaper build was actually *worth it* -- comparing it against Pattern's
own verdict/`coverage_pct` would be circular, since that's the very thing
being evaluated. `report_outcome_proxy` attaches a cheap, non-circular
value signal per `feature_id` instead:

- **`reworked` / `days_to_rework`** (primary proxy) -- was any file this
  feature's build touched modified again after the original merge, and if
  so, how soon? Computed from real git history, not Pattern's own data.
- **`time_to_merge_hours`** (secondary proxy) -- how long the feature
  took from first commit to merge.
- **`status_at_30d`** (tertiary, longer-horizon proxy) -- at a ~30-day
  horizon, does the component Pattern recommended still exist in the
  codebase, unchanged in kind (`"kept"`), was it swapped for a different
  approach (`"replaced"`), or removed entirely (`"removed"`)?

`read_ledger`'s `feature_id` rollup returns both `outcome_proxy` (the
merged latest-value-per-field view) and `outcome_proxy_history` (every
raw report, in case the timeline itself matters) alongside the cost
figures from [Feature cost attribution](#feature-cost-attribution) above
-- so "what did this feature cost end to end, and did it hold up?" is
answerable from one `read_ledger` call.

## Per-project judgment ledger

Distinct from [per-project decision memory](#per-project-decision-memory)
below -- that file only gains an entry when `record_component_decision` is
explicitly called. The ledger instead gains one entry automatically for
**every** `recommend_component` call with a `project_id` that lands on
reason `"scored"` or `"no_candidates_found"` -- whether that's a fresh
call that reached the API, or a $0 [ledger cache
hit](#the-cache-hit-exception) served without one (`cache_hit: true`,
`cost_usd: 0`), so a feature's total cost still rolls up correctly even
once most of its later calls are free. See [Feature cost
attribution](#feature-cost-attribution).

Pattern stores it locally in:

```
~/.pattern/ledger.jsonl
```

Change the location with `PATTERN_LEDGER_PATH`. One JSON object per line
(append-only, JSONL).

### The cache-hit exception

Every other part of Pattern scores fresh every time (see
[No caching, by design](#no-caching-by-design)). The ledger is the one
deliberate exception: a later `recommend_component` call with a matching
`project_id` **can** be served directly from a prior entry, skipping
search+score entirely, when **all** of the following hold:

- `component_need` matches exactly (case-insensitive).
- `domain` and `framework` match exactly.
- `existing_stack` hashes to the same value as the stored entry's
  (both omitted counts as a match).
- The stored entry's `confidence` is `"high"`.
- The stored entry's `reason` is `"scored"` or `"no_candidates_found"`.
- The stored entry is no older than `PATTERN_LEDGER_TTL_DAYS` (default
  **30** days, configurable).

When served this way, the response has `reason: "ledger_cache_hit"`,
`served_from_ledger: true`, `ledger_entry_id`, and
`original_verdict_timestamp` -- so nothing is ever silently passed off as
freshly verified. `_meta.estimated_cost_usd` and `tokens_used` are
genuinely `0`: no API call happened. `requirements_checked` is `null` on
this path -- the ledger never stores per-requirement evidence text (see
[Data minimization](#data-minimization)), so a cache hit can only replay
the verdict/confidence/coverage/chosen-candidate, not the original
per-requirement reasoning.

Any mismatch on the criteria above -- a different `domain`, a changed
`existing_stack`, an entry that's gone stale, or one that wasn't
high-confidence -- falls through to a normal, fresh search+score call.

### Turning the cache-hit exception off

Set `PATTERN_NO_LEDGER_CACHE_HIT` (any truthy value) to restore
"every `recommend_component` call always scores fresh" without removing
any ledger code. This disables only the cache-hit short-circuit --
entries are still written to `ledger.jsonl` and `read_ledger` still works
either way, so the audit trail keeps growing even with the switch on.
Unset the variable to re-enable cache hits again at any time.

### Data minimization

Nothing written to the ledger ever contains raw search/fetch content.
Every candidate is reduced to exactly four fields before it's written --
`source`, `name`, `url`, `coverage_pct` -- enforced at the type level
(`assertDistilledCandidateShape` in `src/index.ts`), not just by
convention: a raw or extended object throws rather than silently
persisting. Run `node scripts/verify-ledger-boundary.mjs` (after
`npm run build`) to check this boundary directly.

## Ledger integrity and decision provenance

Two gaps in the ledger, surfaced from user feedback: it tracks that a
decision was made, but not whether the thing it decided about is still
live in your codebase, and it stores the checklist/verdict but not a
version pin or an exportable artifact you can attach to a PR or issue.
This section covers what's shipped so far -- **P0/P1 of both halves**, not
the full spec. See `pattern-ledger-integrity-and-provenance-spec.md` for
the complete phased plan; P2/P3 (a scheduled/batch sweep, dangling-cluster
detection, the provenance-artifact exporter, and GitHub PR/issue posting)
are not built yet.

**This is the one deliberate exception** to Pattern otherwise having [no
filesystem/git access to your repo](#per-project-judgment-ledger) at all
(the principle `report_build_cost`/`report_outcome_proxy` are built
around). It's narrow on purpose:

- `git rev-parse HEAD` (read-only, never touches repo state) to capture
  `snapshot_ref` on every ledger write.
- `fs.existsSync` plus a plain-text read of one file, only for a
  `file_path` you explicitly passed to `recommend_component`, only inside
  `PROJECT_ROOT` (see below), to answer `check_ledger_liveness`.

Nothing here runs an arbitrary git or shell command, and nothing writes to
your repo.

### `PROJECT_ROOT`

Defaults to `process.cwd()` -- for a locally-run stdio MCP server, that's
normally the consuming repo's root, since MCP hosts typically launch the
server with the project directory as its working directory. Override with
`PATTERN_PROJECT_ROOT` if that assumption doesn't hold for your setup.

A `file_path` that's absolute or escapes `PROJECT_ROOT` via `../` resolves
to `live_status: "unknown"` rather than being read -- belt-and-suspenders,
since the calling agent already has real filesystem access to its own
machine regardless.

### Decision provenance: `snapshot_ref`

Every ledger entry -- fresh judgment or [ledger cache
hit](#the-cache-hit-exception) -- now carries `snapshot_ref`: the commit
SHA of `PROJECT_ROOT` at the moment that line was written, or `null` when
`PROJECT_ROOT` isn't a git repo (or `git` isn't installed, or the call
times out) -- this never fails the underlying `recommend_component` call.
Entries written before this shipped read back with `snapshot_ref: null`.

A cache-hit entry's `snapshot_ref` reflects the codebase state *when that
cache-hit line was written*, not the original judgment's -- to see the
original judgment's snapshot, look up the entry named in its
`ledger_entry_id`/`original_verdict_timestamp` fields instead.

[`export_ledger_provenance`](#tool-export_ledger_provenance) packages one
entry's full record -- checklist, candidates, verdict, `snapshot_ref` --
into a markdown block you can paste into a PR or issue by hand.
[`post_ledger_provenance_to_github`](#tool-post_ledger_provenance_to_github)
posts that same artifact automatically, idempotently, using a personal
`GITHUB_TOKEN` rather than a GitHub App (see that tool's docs for why).
[`backfill_ledger_snapshot_ref`](#tool-backfill_ledger_snapshot_ref)
reconstructs a best-effort `snapshot_ref` for entries that predate the
field, always clearly labeled as reconstructed wherever it's rendered.

### Referential integrity: `file_path` / `live_status`

`recommend_component` optionally accepts `file_path` (see [Tool:
`recommend_component`](#tool-recommend_component)) -- usually not known at
call time, since the decision typically precedes the file existing. When
set, [`check_ledger_liveness`](#tool-check_ledger_liveness) can later
check whether that file still exists and still mentions
`chosen_candidate`:

- **`live`** -- the file exists and mentions `chosen_candidate`.
- **`orphaned`** -- `file_path` is set but the file no longer exists.
- **`unknown`** -- no `file_path` was ever recorded, the path escapes
  `PROJECT_ROOT`, or the file exists but `chosen_candidate` can't be
  confirmed in it. Deliberately the default outcome for anything
  ambiguous: a false `"orphaned"` is worse than a lingering `"unknown"`.
- **`dangling`** -- only ever produced by
  [`sweep_ledger_liveness`](#tool-sweep_ledger_liveness), never by
  `check_ledger_liveness` on its own: a cluster of 2+ entries sharing a
  `feature_id` where none of them resolved to `"live"`. Graph-level
  analysis across a project's whole entry set, not a single-entry check
  -- see that tool's docs for why `feature_id` is the grouping used.

`check_ledger_liveness` remains on-demand and single-project;
[`sweep_ledger_liveness`](#tool-sweep_ledger_liveness) is the
scheduled/batch counterpart -- meant to be invoked by your own cron/CI,
since Pattern has no scheduler of its own. `live_status`/`last_verified_live`
start `"unknown"`/`null` on every entry at write time and only ever
advance via a `check_ledger_liveness`/`sweep_ledger_liveness` call;
results are stored append-only in `~/.pattern/ledger_liveness.jsonl`
(override with `PATTERN_LEDGER_LIVENESS_PATH`, same "append, never mutate
the source line, most recent record wins at read time" convention as
`outcome_proxies.jsonl`, see [Outcome proxies](#outcome-proxies)) and
layered onto `ledger.jsonl`'s own entries at read time -- the ledger line
itself is never rewritten.

## Per-project decision memory

Pattern stores confirmed decisions locally in:

```
~/.pattern/memory.json
```

You can change the location with:

```
PATTERN_MEMORY_PATH
```

The file is organized by project:

```json
{
  "my-booking-app": [
    {
      "component_need": "price breakdown with fees and taxes",
      "domain": "Airbnb-style rental marketplace",
      "action": "custom_built",
      "source": "custom",
      "timestamp": "2026-08-25T14:32:00.000Z",
      "time_saved_minutes": 25
    }
  ]
}
```

`time_saved_minutes` is omitted from an entry entirely when the calling
agent didn't provide one -- it's never backfilled or estimated by Pattern.

Each project keeps its 50 most recent decisions. Older entries are
removed as new ones are added.

Only decisions explicitly recorded through `record_component_decision`
are saved. Pattern does not automatically save recommendations.

If an agent ignores or changes a recommendation, nothing is recorded
unless the agent explicitly calls `record_component_decision` with what
it actually did.

The memory file is local plaintext. Pattern does not send it anywhere.

`component_need` and `domain` are stored in this file, so avoid putting
sensitive information in them. See [SECURITY.md](./SECURITY.md).

A failure to write the decision file is returned as an error from
`record_component_decision`.

**No caching, by design.** Project memory (this file, `memory.json`) does
not cache recommendations. A previous decision is only additional context
for a new judgment. This is unrelated to the
[judgment ledger](#per-project-judgment-ledger)'s bounded cache-hit
exception, which lives in a separate file (`ledger.jsonl`) and is always
flagged (`served_from_ledger: true`) when it happens — see
[Known limitations](#known-limitations) for more.

## Security and privacy

Pattern uses the Anthropic API and web search to make its
recommendations.

Local project memory and the local call log are stored on the machine
running Pattern. They are not sent anywhere by Pattern itself.

The one exception is opt-in telemetry, off by default -- see
[Telemetry](#telemetry) below for exactly what it sends and how to turn
it on or off.

Review [SECURITY.md](./SECURITY.md) before putting sensitive information
into fields such as `component_need`, `domain`, or project IDs.

## Telemetry

Off by default. Nothing is sent anywhere for telemetry purposes unless
you explicitly set:

```
PATTERN_TELEMETRY=1
```

**The one-time notice.** The first time you run this version of Pattern
-- whether it's a brand-new install or an upgrade from a version before
telemetry existed -- it prints a short notice to stderr explaining all of
this and how to opt in. It prints exactly once, ever (tracked by a marker
file at `~/.pattern/telemetry_notice_shown`), then never again, regardless
of whether you act on it. There's no interactive y/n prompt: Pattern's
stdin is the MCP JSON-RPC channel the client uses to talk to it, so
blocking on stdin for a keypress would fight the protocol handshake
instead of showing a dialog -- a stderr notice is the safe equivalent for
a stdio MCP server.

**Why it exists.** Two things about real usage can't be answered from
this repo alone: whether people actually come back and use Pattern on a
second or third project on their own, and how often a BYO Anthropic key
actually hits a rate limit or runs out of credit in real sessions, not
just the one time that happened during manual testing (see
[Known limitations](#known-limitations)). Telemetry answers both without
requiring anyone to fill out a survey.

**What gets sent, when enabled:**

- An anonymous, randomly generated install ID -- a UUID created once and
  stored at `~/.pattern/install_id` (overridable via
  `PATTERN_INSTALL_ID_PATH`), never derived from your machine, username,
  or any other identifying information. This is the only thing that ties
  two events together as "the same install."
- A one-way SHA-256 hash of `project_id`, truncated to 16 hex characters
  -- never the raw `project_id` string. The hash lets Pattern count how
  many *distinct* projects one install has used, without ever seeing what
  those projects are named.
- On every `recommend_component` call that reaches the API or the ledger
  cache-hit shortcut: `verdict`, `confidence`, `reason`,
  `ensemble_triggered`, `estimated_cost_usd`, and `served_from_ledger` --
  the same distilled shape already written to the
  [local call log](#local-call-log), not new information.
- On a failed Anthropic API call specifically: the HTTP status code and a
  coarse classification (`rate_limit`, `insufficient_credit`, or `other`)
  -- never the request or response body.

**What never gets sent, telemetry on or off:** `component_need`,
`domain`, `framework`, `existing_stack`, `requirements_checked` evidence,
the raw `project_id`, or your Anthropic API key.

**Where it goes.** Events go to Pattern's PostHog project via its public,
write-only project key (safe to ship in source -- it can send events, it
cannot read data back). Set `PATTERN_POSTHOG_KEY` /
`PATTERN_POSTHOG_HOST` to point at a different project, e.g. for
self-hosting.

**Turning it off** is the default -- just don't set `PATTERN_TELEMETRY`.
If you'd previously enabled it, unset the variable (or set it to `0`) to
go back to fully local.

## Cost

Pattern uses the Anthropic API, so `recommend_component` has a cost.

A typical single pass costs about $0.06–$0.10 with Sonnet 5 at current
pricing. Skip-listed primitives cost $0 because they're handled locally
and never reach the API. A [ledger cache hit](#the-cache-hit-exception)
also costs $0, for the same reason -- no API call happens.

### The `_meta` field

Every `recommend_component` and `extract_requirements` response includes
an internal `_meta` block reporting what that call actually spent. This
is not shown to the user automatically -- the calling agent has to
surface it, the same way it's separately instructed to show
`install_command` before running it (see
[above](#installation-commands-are-not-trusted)). Both tool descriptions
say so explicitly: surface `_meta.estimated_cost_usd` after the call,
since it's real spend against the user's own API key, not internal
bookkeeping.

```json
{
  "total_ms": 41516,
  "breakdown_ms": { "extract": 5006, "search": 3114, "score": 33396 },
  "tokens_used": { "input": 8400, "output": 620 },
  "estimated_cost_usd": 0.14,
  "scoring_fetch": { "attempted": true, "succeeded": true, "url": "https://ui.shadcn.com/docs/components/..." }
}
```

- `total_ms` -- wall-clock time for the call.
- `tokens_used` -- total input tokens (fresh + cache write + cache read,
  summed) and output tokens, read directly from the API response's own
  usage data.
- `estimated_cost_usd` -- computed from `tokens_used` at Pattern's
  configured model's current per-token rate (checked against Anthropic's
  pricing, not assumed). This is an estimate: it doesn't account for
  pricing changes Pattern hasn't been updated for, or any account-specific
  discounts.
- `breakdown_ms` -- how `total_ms` splits across `recommend_component`'s
  three internal phases.
- `scoring_fetch` -- whether step 4's single candidate-verification fetch
  (see [Fetch-grounded scoring](#fetch-grounded-scoring-and-reference-verification)
  below) actually happened for this response. `url` is `null` when
  `attempted` is `false` (no real candidate to verify, e.g. `reason:
  "no_candidates_found"` or `"skip_list"`). This is a diagnostic only --
  Pattern never uses it to auto-correct `requirements_checked` after the
  fact, since there's no safe fallback value for an unverified met/not-met
  call the way there is for a reference URL.

**How `breakdown_ms` is measured, and its one real caveat.** The bundled
call runs extraction, search, and scoring inside a single model turn
(search/fetch happen server-side, not as separate requests this code
makes), so there's no natural place for three separate stopwatches.
Pattern gets a real per-phase split by streaming the response and timing
content-block boundaries instead: `extract` ends the moment the first
search call starts, and `search` ends when that first wave of search
calls and results finishes. This was checked against real traces (not
assumed) across both `use_existing` and `custom_build` cases before
shipping, and both boundaries land cleanly and consistently.

The one place this needs a caveat: for a `custom_build` verdict, step 6's
Mobbin/Figma reference search and its deep-link verification fetch happen
*after* the coverage-scoring reasoning that decided `custom_build` in the
first place -- so `breakdown_ms.score`, for those cases, covers coverage
scoring **and** reference-finding **and** the final write-up, not just
"scoring" in the narrow step-4 sense. It's still a real, measured number;
it's just a wider bucket for `custom_build` than for `use_existing`. This
is disclosed here rather than presented as a narrower number than it is.

**When the ensemble triggers** (see below), `_meta` reports the sum
across all reruns that actually happened -- total tokens and cost spent,
not the wall-clock time you waited. The three ensemble passes run with the
2nd and 3rd concurrent, so perceived latency is closer to ~2x one pass,
not the ~3x `total_ms` will show. Cost and token spend are genuinely
additive across reruns, which is what `_meta` is reporting there.
`scoring_fetch` is the one exception -- it isn't summed (a fetch either
happened for the specific pass whose evidence became the returned
`requirements_checked`, or it didn't), so it reports that winning pass's
own value, not an aggregate across all three.

Three things help keep the cost down without changing the decision process.

### Prompt caching

Pattern caches its system instructions using `cache_control: ephemeral`.

The instructions are the same across calls, so repeated requests don't
pay the full input cost for that block.

### Search limits

Pattern limits candidate discovery to 3 web searches -- one per source.

If a custom build is needed, it reserves 2 additional searches for
references:

- 1 for Mobbin
- 1 for Figma Community

shadcn/ui, 21st.dev, and ReUI are searched in the same turn rather than
sequentially, which reduces how much conversation context needs to be
sent repeatedly.

### Fetch-grounded scoring and reference verification

Pattern allows up to 3 `web_fetch` calls per pass: 1 reserved for scoring,
2 reserved for reference verification (1 for Mobbin, 1 for Figma
Community).

Before finalizing coverage, Pattern fetches the best-fitting candidate's
own real docs/source page once and re-checks the checklist against that
page, not just the search-result snippet it started with. This exists
because search-result descriptions can both overstate a component's real
capabilities and miss real ones it actually has -- both were observed in
testing on the same case (an invented feature claim and a missed real
one). If the fetch fails, or there's no confirmed URL to fetch, Pattern
falls back to search-only evidence and says so in the affected items.

Each result's `_meta.scoring_fetch` reports whether this fetch actually
happened for that response (`{ attempted, succeeded, url }`) -- it's a
diagnostic, not something Pattern uses to auto-correct individual
requirement judgments. Unlike a reference URL (which has a safe fallback:
the category page), there's no safe fallback for an unverified met/not-met
call, so nothing is silently corrected -- `scoring_fetch` just tells you
whether the grounding actually ran.

A fetch can read up to 15,000 content tokens. `web_fetch` has no separate
per-call fee; the cost comes from the content added to the model's
context.

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
  "reference_sources_grounded": ["Mobbin", "Figma Community"],
  "checklist_source": "extracted",
  "total_ms": 44834,
  "estimated_cost_usd": 0.15
}
```

Additional fields appear when relevant:

- `ensemble_agreement` appears when the ensemble runs.
- `reference_sources_grounded` appears for `custom_build` results and
  lists only sources that produced a grounded reference.

`checklist_source`, `total_ms`, and `estimated_cost_usd` mirror the
call's `_meta` block (see [Cost](#cost)) -- `total_ms` and
`estimated_cost_usd` are the same aggregated-across-reruns numbers when
the ensemble triggers, not per-pass figures.

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

### A staged pipeline was evaluated and not adopted

To address the variance above, an alternative architecture was built and
tested: splitting the single bundled judgment call into separate stages
(extract requirements, search evidence, score coverage), on the theory
that isolating each step would make results more consistent and easier
to diagnose.

A pilot comparison (5 cases, 3 repeated runs per case, per
architecture) found no consistent benefit. The staged pipeline improved
consistency on one boundary-risk case but was less consistent than the
bundled pipeline on another, including one run that failed outright.
Net accuracy against hand-graded gold answers was statistically
indistinguishable between the two architectures, and the staged
pipeline cost roughly **2x** the bundled pipeline's call volume across
the board, not only on the boundary-risk cases it was expected to help
most.

Pattern ships the bundled pipeline. The staged implementation remains
in the repo (`src/staged/`) as an evaluated, unshipped experiment, not
a supported alternative.

**`extract_requirements` is not a revival of this.** It's a standalone
tool for inspecting the extraction step's output before an agent commits
to `recommend_component`'s search+score budget -- an opt-in visibility
tool, not an internal re-architecture. `recommend_component`'s own
pipeline is still fully bundled; nothing about this evaluation changed.

### No caching, by design

Every recommendation searches and scores again -- with one bounded
exception (see below).

This means a recommendation can change as component libraries change.
For example, a later shadcn/ui release can introduce a component that
changes a previous `custom_build` result.

Do not build a second, unbounded cache of recommendations at the
calling-agent layer on top of Pattern's own. If you add caching there,
keep it session-scoped.

[Project decision memory](#per-project-decision-memory) does not change
this. It provides context from previous decisions, but every
`recommend_component` call still performs a fresh search and scoring
pass.

The one deliberate exception is the
[judgment ledger's cache-hit path](#the-cache-hit-exception): a later
call matching an exact, recent, high-confidence prior judgment can be
served without a fresh search+score. It's bounded (exact
component_need/domain/framework/conventions match, a staleness TTL) and
always self-identifies via `served_from_ledger: true` and
`reason: "ledger_cache_hit"` -- so a calling agent that wants a guaranteed
fresh check on every call should look for that flag and treat it the same
as any other verdict it wants to double-check.

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

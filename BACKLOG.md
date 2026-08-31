# Pattern — Backlog

## Canonical intent schema + per-source adapters

Today, source discovery (shadcn/ui, 21st.dev, ReUI, Mobbin, Figma Community) all
happens through generic, freeform `web_search`/`web_fetch` calls against live
docs and search results — re-derived from prose on every single call, with no
structured, maintained capability model per library.

**The idea:** define a canonical schema for "what a UI need is" — props,
behaviors, states, a11y requirements — the same vocabulary
`extract_requirements` currently derives freehand per call. Translate that
schema into library-specific checks through a dedicated adapter per source
(a shadcn/ui adapter, a 21st.dev adapter, a ReUI adapter, separate
grounding-shaped adapters for Mobbin/Figma Community since those are
reference sources, not existing-component sources).

**Why this is the moat, not the schema itself:** mirrors what actually makes
OpenRouter defensible. It doesn't force every provider into one shape — it
absorbs each provider's quirks behind a stable canonical request. The
per-provider adapters are what compounds into real defensibility over time,
not the unified surface as a standalone claim. Own the schema; let the
adapters absorb the mess.

**Why this also isn't just a positioning play:** it's a structural fix for the
cost and consistency problems already tracked below and in the Pattern
Briefing (§03/§05) — coverage currently lands inconsistently between runs
partly *because* there's no maintained capability model per library, just a
fresh live-fetched doc page of varying quality/length judged from scratch
every call. A maintained adapter replaces re-fetching and re-judging the same
library's docs on every single call.

**Scope (rough — needs its own design pass before this is properly sized):**

- Canonical requirement schema: the fixed vocabulary `extract_requirements`
  should target, instead of deriving requirements freehand per call.
- Per-source adapter interface: each adapter owns (a) how it searches/indexes
  its source's real components, (b) a maintained, not re-fetched-per-call,
  capability model per component/pattern, (c) translation from the canonical
  schema into that adapter's own scoring logic.
- Start with **one adapter** (shadcn/ui — most structured, most predictable
  docs) as a proof of concept. Do not build all five adapters up front.
- Mobbin/Figma Community need a different adapter shape than
  shadcn/21st.dev/ReUI — they're grounding/deep-link-verification sources for
  a `custom_build` reference, not coverage-scored existing-component sources.

**Out of scope for now:** generalizing past one adapter before validating it.
Same evaluate-before-generalize discipline as the staged-pipeline decision —
measure one real adapter's accuracy and cost against the existing validation
set before committing to the other four.

**Relationship to the cost/latency plan below:** larger and more strategic —
if it ships, a maintained per-library capability model would likely subsume
steps 2-3 of that plan entirely (no more per-call doc fetch to cap in the
first place). It's a much bigger effort, though, and shouldn't block the
already-scoped cost work below from shipping in the meantime.

**Effort:** large, not yet sized — needs a design pass on the schema and the
adapter interface before any of this is estimable.

---

## Cost/latency reduction plan for `recommend_component`

Real usage this week (a live 35-call product build, plus a follow-up verification
session) grounded a cost investigation that was previously speculative. Two
changes already shipped in `src/index.ts`:

- **Adaptive ensemble escalation** — `judgeComponent`'s boundary-risk branch now
  runs 2 passes and only escalates to a 3rd on a genuine tie, instead of a flat
  3 every time. Confirmed live and running. **Not yet validated**: no test case
  has actually landed in the boundary-risk zone since shipping, so the
  tie-escalation branch itself has never fired. Needs a component need that
  genuinely lands in the 40%/80% coverage boundary to prove — not something a
  prompt's wording can reliably force, since it depends on what the search step
  turns up at run time.
- **Cache visibility instrumentation** — `_meta.tokens_used` now splits into
  `{fresh, cache_write, cache_read}` instead of one summed number
  (`buildMeta`, `aggregateMeta`). Confirmed live and working. It overturned the
  working hypothesis that Anthropic's internal server-tool turns get no cache
  benefit beyond the single system-prompt `cache_control` breakpoint: a fresh,
  non-repeat call to a toast component came back with **roughly half its input
  tokens served from `cache_read`**. This changes the expected payoff of the
  next two items below — real, but smaller than a "nothing is cached" model
  would have predicted, since cutting content shrinks a mix of full-price and
  already-10x-discounted tokens, not purely full-price ones.

**Scope, in order — do not batch these together, each needs its own before/after measurement:**

1. **Expand the instrumentation sample before sizing any cap change.** Pull the
   `fresh`/`cache_write`/`cache_read` split from 3-4 more real calls spanning
   different shapes: a clean single-pass `use_existing`, a `custom_build` with
   step-6's extra Mobbin/Figma fetches, and an ensemble-triggered call. Goal:
   confirm whether the ~50% cache_read share is stable regardless of call
   complexity (implies the fixed cached portion is the system prompt +
   early boilerplate, and the uncached half is dominated by new fetched
   pages/search results — confirming steps 2-3 below are still the right
   levers) or scales with turn count (a different, more interesting mechanism
   worth understanding before touching caps).
2. **Give step 4's candidate-verification fetch its own, smaller
   `max_content_tokens`**, separate from step 6's Mobbin/Figma cap (both
   currently share one 15,000-token limit, sized for step 6's "category/browse
   pages can be large" reasoning — a shadcn/ReUI doc page rarely needs that
   much). Size the new cap from real fetched-page lengths pulled from this
   week's call logs, not a guess. Ship in isolation from step 3 below — it's a
   single deterministic number with no accuracy surface, easy to attribute a
   clean before/after delta to. Re-run the same instrumented sample set after
   shipping and compare total cost and the fresh/cache_read split directly.
3. **Evaluate dropping `PATTERN_SEARCH_BUDGET`'s default from 3 to 2**
   separately from step 2, with its own accuracy check. Unlike step 2, this can
   change which candidates get found at all — an accuracy risk, not just a
   cost one, closer in kind to the staged-pipeline evaluation than to a cache
   tweak. Check against the existing validation cases (see
   [`PRODUCT_BRIEF.md`](./PRODUCT_BRIEF.md)'s five-case set, or the 25-case
   eval set referenced in
   [`validation-plan-staged-pipeline.md`](./validation-plan-staged-pipeline.md))
   before shipping. Do not bundle with step 2 — mixing them makes it
   impossible to tell which change caused which effect.

**Out of scope for this pass:** re-opening the staged-pipeline question (already
evaluated and rejected, see `validation-plan-staged-pipeline.md`) and any change
to the confidence-gated ledger cache-hit rule (`findLedgerCacheHit`'s
`confidence !== "high"` gate) — both were discussed and deliberately left alone
this round.

**Effort:** small, sequential — each step is a single isolated change plus a
remeasurement pass; the discipline is in not skipping the remeasurement or
batching steps together, not in the size of any individual diff.

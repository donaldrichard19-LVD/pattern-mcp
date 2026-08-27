# Validation plan: staged pipeline

> **Provenance note:** this file was referenced by five other files in the
> repo (`scripts/phase0-tighten-gold-extraction.mjs`,
> `scripts/phase1-extraction-only.mjs`, `scripts/phase2-staged-smoke-test.mjs`,
> `scripts/phase3-comparison.mjs`, `src/staged/types.ts`,
> `eval/eval-set.json`) as the plan document driving this work, but it does
> not exist on disk or anywhere in `git log --all`. It was evidently never
> committed. The **Background** through **Result** sections below are a
> reconstruction assembled from what those files' own headers/metadata say
> and from the summary already published in `README.md`'s "Known
> limitations" section — not a recovery of the original document's actual
> wording. Treat that reconstruction as a factual skeleton, not a verbatim
> record. The **Category-level accuracy** section is new work, added
> 2026-08-26, and is not a reconstruction.

## Background

Pattern's bundled pipeline does requirement extraction, evidence search,
and coverage scoring inside a single model call. Validation surfaced
cases where two runs against the same search results reached different
judgments of the same evidence (see README's "Model judgment can vary").
This plan tested whether splitting that single call into separate stages
— extract, search, score — would make results more consistent and
easier to diagnose, before deciding whether to ship it as a replacement
for the bundled pipeline.

## Phase 0 — Eval set

Built `eval/eval-set.json`: 25 hand-written Airbnb-style rental-marketplace
component needs across four categories — `search_discovery` (5),
`listing_detail` (6), `booking_checkout` (7), `host_guest_account` (7) —
each with a gold verdict and an 8-item requirements checklist. 5 of the
25 are the project's original hand-validated cases from
`PRODUCT_BRIEF.md`, reused as-is except where later live testing had
already established a more reliable finding.

The gold answers went through a second tightening pass: an independent
extraction cross-check (`eval/gold-tightening-extraction.json`) run
against all 25 cases using the same stricter standard that a Phase 2
smoke-test surprise (`date-range-picker`) had exposed — the original
gold had been graded on "a plausible pattern exists" rather than
checking every specific requirement. 21 of 25 held up; 4 were revised
(`date-range-picker`, `availability-calendar`, `notification-preferences`,
`filter-panel`).

## Phase 1 — Extraction-only isolation test

Ran requirement extraction alone — no search, no scoring — 3x per case
on a subset of the eval set, to check whether extraction itself was
unstable before committing to the cost of a full staged rebuild.
Logged to `eval/phase1-extraction-log.json`.

## Phase 2 — Staged pipeline smoke test

Built `src/staged/` (extract → search → score as separate calls, plus
`reference.ts` for deep-link verification) and ran it end-to-end on a
subset to confirm it produces sane, independently-logged output before
committing to the full comparison. Logged to
`eval/phase2-smoke-test-log.json`. This pass is what surfaced the
`date-range-picker` gold-answer problem that triggered the Phase 0
tightening pass above.

## Phase 3 — Bundled vs. staged comparison

Head-to-head comparison on a 5-case pilot (`search-map-toggle`,
`availability-calendar`, `image-gallery`, `date-range-picker`,
`host-earnings-dashboard`), 3 repeated runs per architecture per case,
via `scripts/phase3-comparison.mjs`. The bundled pipeline was invoked as
a real MCP tool call against `dist/index.js`; the staged pipeline was
invoked directly. Measured accuracy against gold, consistency across
the 3 repeated runs, and cost by raw call count. Logged to
`eval/phase3-comparison-log.json`.

### Result

A pilot comparison (5 cases, 3 repeated runs per case, per architecture)
found no consistent benefit. The staged pipeline improved consistency on
one boundary-risk case but was less consistent than the bundled pipeline
on another, including one run that failed outright. Net accuracy against
hand-graded gold answers was statistically indistinguishable between the
two architectures, and the staged pipeline cost roughly 2x the bundled
pipeline's call volume across the board, not only on the boundary-risk
cases it was expected to help most.

**Decision:** ship the bundled pipeline. `src/staged/` stays in the repo
as an evaluated, unshipped experiment, not a supported alternative. (See
README.md, "A staged pipeline was evaluated and not adopted.")

## Category-level accuracy

**Question:** are narrower, more common component categories (e.g.
`booking_checkout`) inherently easier and more consistent to judge than
broader or more bespoke ones (e.g. `host_guest_account`), independent of
the bundled-vs-staged question above? This uses the same 25-case eval
set and gold answers, segmented by the `category` field already on each
case.

**Data available.** Only the Phase 3 pilot's 5 cases have full
accuracy/consistency data (3 bundled runs each, recorded in
`eval/phase3-comparison-log.json`). The other 20 cases have not been run
under this methodology. Per category, that leaves:

| Category | Cases measured / total |
|---|---|
| `search_discovery` | 1 / 5 (`search-map-toggle`) |
| `listing_detail` | 2 / 6 (`image-gallery`, `availability-calendar`) |
| `booking_checkout` | 1 / 7 (`date-range-picker`) |
| `host_guest_account` | 1 / 7 (`host-earnings-dashboard`) |

That is 1–2 cases per category out of totals of 5–7 — far too sparse to
test a category-level claim on its own. The numbers below describe what
those 5 measured cases show, not a validated category-level pattern.
**20 of 25 cases remain unmeasured under this methodology; this section
does not run them** (see provenance note above — that run was
deliberately deferred, not attempted and dropped).

**Per-case results (bundled pipeline, 3 runs each):**

| Case | Category | Gold verdict | Run verdicts | Accuracy | Consistent? |
|---|---|---|---|---|---|
| `search-map-toggle` | `search_discovery` | `custom_build` | custom_build, custom_build, custom_build | 3/3 | yes |
| `availability-calendar` | `listing_detail` | `use_existing` | use_existing, use_existing, use_existing | 3/3 | yes |
| `image-gallery` | `listing_detail` | `use_existing` (gold notes: genuinely boundary, don't treat as fixed ground truth) | custom_build, use_existing, custom_build | 1/3 | no — flipped |
| `date-range-picker` | `booking_checkout` | `custom_build` | custom_build, custom_build, custom_build | 3/3 | yes |
| `host-earnings-dashboard` | `host_guest_account` | `use_existing` | custom_build, use_existing, custom_build | 1/3 | no — flipped |

**Per-category rollup (n = cases measured, not full category size):**

- `search_discovery` (n=1): 3/3 runs matched gold, 0 of 1 case flipped
- `listing_detail` (n=2): 4/6 runs matched gold (67%), 1 of 2 cases flipped
- `booking_checkout` (n=1): 3/3 runs matched gold, 0 of 1 case flipped
- `host_guest_account` (n=1): 1/3 runs matched gold, 1 of 1 case flipped

**Finding.** With 1–2 cases per category, this data cannot confirm or
refute the claim that narrower categories like `booking_checkout` are
inherently easier or more consistent to judge than broader ones like
`host_guest_account`. It is not a large enough sample to distinguish
"one category is genuinely harder" from ordinary case-to-case noise.

What it does show: the one case most aligned with the "harder, bespoke"
side of the claim — `host-earnings-dashboard`, a dashboard — was in fact
the least consistent result in this batch (1/3 accuracy, verdict flipped
across runs). But the case it's being compared against on the "easier"
side, `date-range-picker` (`booking_checkout`), was fully consistent,
and the `listing_detail` category split evenly: one case
(`availability-calendar`, itself a calendar — exactly the kind of
component the claim predicts should be hard) was perfectly consistent,
while the other (`image-gallery`) was not.

More directly: both cases that showed instability here —
`image-gallery` and `host-earnings-dashboard` — are flagged in
`eval/eval-set.json`'s own gold-authoring notes as genuinely close,
boundary-risk calls, independent of category. `image-gallery`'s gold
answer explicitly says not to treat any single verdict as fixed ground
truth for it. Both are also 2 of the project's original 5
hand-validated cases, selected in the first place because they sit near
a scoring threshold — not because they're representative samples of
their categories. That is a more direct explanation for the instability
observed here than category breadth is.

Difficulty does not read as cleanly concentrated in one or two
categories in this data, but there isn't enough data to say it's spread
evenly either — both readings are consistent with 5 cases. Testing the
category-difficulty claim properly requires running the remaining 20
cases (3 bundled runs each, same methodology) so each category has
enough measured cases to compare consistency rates against each other,
not just against gold on a single example.
